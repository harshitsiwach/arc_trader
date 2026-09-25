import { useCallback, useEffect, useState } from 'react'
import { useAccount, useWriteContract } from 'wagmi'
import {
  ROUNDS_ADDR,
  USDC_ADDR,
  VAULT_ADDR,
  erc20Abi,
  fromBase,
  loadBetIds,
  readBet,
  readRound,
  roundsAbi,
  saveBetId,
  testnetClient,
  toBase,
  vaultAbi,
  type OnchainBet,
  type OnchainRound,
} from '../lib/onchain'

/** Onchain testnet betting: Vault deposits, Rounds bets, claims, withdrawals.
 * Pass asAddress to read as a smart-account address instead of the wallet. */
export function useOnchainBetting(asAddress?: string) {
  const { address, chainId } = useAccount()
  const reader = asAddress ?? address
  const [vaultBalance, setVaultBalance] = useState<bigint | null>(null)
  const [walletUsdc, setWalletUsdc] = useState<bigint | null>(null)
  const [openRound, setOpenRound] = useState<OnchainRound | null>(null)
  const [lockedRound, setLockedRound] = useState<OnchainRound | null>(null)
  const [myBets, setMyBets] = useState<(OnchainBet & { roundStatus: number; roundResult: number; roundPayout: number })[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const { writeContractAsync } = useWriteContract()

  const refresh = useCallback(async () => {
    if (!reader) return
    try {
      const [vb, wu, count] = await Promise.all([
        testnetClient.readContract({ address: VAULT_ADDR as `0x${string}`, abi: vaultAbi, functionName: 'balances', args: [reader as `0x${string}`] }) as Promise<bigint>,
        testnetClient.readContract({ address: USDC_ADDR as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf', args: [reader as `0x${string}`] }).catch(() => null) as Promise<bigint | null>,
        testnetClient.readContract({ address: ROUNDS_ADDR as `0x${string}`, abi: roundsAbi, functionName: 'roundCount' }) as Promise<bigint>,
      ])
      setVaultBalance(vb)
      if (wu != null) setWalletUsdc(wu)
      let open: OnchainRound | null = null
      let locked: OnchainRound | null = null
      for (let id = count; id > 0n && id > count - 4n; id--) {
        const r = await readRound(id)
        if (r.status === 0 && !open) open = r
        if (r.status === 1 && !locked) locked = r
        if (open && locked) break
        if (id === 1n) break
      }
      setOpenRound(open)
      setLockedRound(locked)
      const ids = loadBetIds()
      const bets: typeof myBets = []
      for (const id of ids.slice().reverse().slice(0, 8)) {
        try {
          const b = await readBet(id)
          if (b.user.toLowerCase() !== reader.toLowerCase()) continue
          const rr = await readRound(b.roundId)
          bets.push({ ...b, roundStatus: rr.status, roundResult: rr.result, roundPayout: rr.payoutBps })
        } catch {
          // bet id beyond chain tip (other wallet's ids) — skip
        }
      }
      setMyBets(bets)
    } catch (e) {
      setNotice(e instanceof Error ? e.message.slice(0, 160) : 'read failed')
    }
  }, [reader])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 4000)
    return () => clearInterval(t)
  }, [refresh])

  const tx = useCallback(
    async (fn: () => Promise<`0x${string}`>) => {
      setNotice(null)
      setPending(true)
      try {
        const hash = await fn()
        await testnetClient.waitForTransactionReceipt({ hash })
        await refresh()
        return true
      } catch (e) {
        setNotice((e as Error)?.message?.slice(0, 200) ?? 'transaction failed')
        return false
      } finally {
        setPending(false)
      }
    },
    [refresh],
  )

  const deposit = useCallback(
    (amountUsdc: number) =>
      tx(async () => {
        const amt = toBase(amountUsdc)
        await writeContractAsync({
          address: USDC_ADDR as `0x${string}`,
          abi: erc20Abi,
          functionName: 'approve',
          args: [VAULT_ADDR, amt],
          chainId: 5042002,
        }).then((h) => testnetClient.waitForTransactionReceipt({ hash: h }))
        return writeContractAsync({
          address: VAULT_ADDR as `0x${string}`,
          abi: vaultAbi,
          functionName: 'deposit',
          args: [amt],
          chainId: 5042002,
        })
      }),
    [tx, writeContractAsync],
  )

  const placeBet = useCallback(
    (roundId: bigint, up: boolean, amountUsdc: number) =>
      tx(() =>
        writeContractAsync({
          address: ROUNDS_ADDR as `0x${string}`,
          abi: roundsAbi,
          functionName: 'placeBet',
          args: [roundId, up, toBase(amountUsdc)],
          chainId: 5042002,
        }).then(async (h) => {
          // best-effort bet id tracking: betCount after placement
          try {
            const n = (await testnetClient.readContract({
              address: ROUNDS_ADDR as `0x${string}`,
              abi: roundsAbi,
              functionName: 'betCount',
            })) as bigint
            saveBetId(n)
          } catch { /* non-fatal */ }
          return h
        }),
      ),
    [tx, writeContractAsync],
  )

  const claim = useCallback(
    (betId: bigint) =>
      tx(() =>
        writeContractAsync({
          address: ROUNDS_ADDR as `0x${string}`,
          abi: roundsAbi,
          functionName: 'claim',
          args: [betId],
          chainId: 5042002,
        }),
      ),
    [tx, writeContractAsync],
  )

  const withdraw = useCallback(
    (amountUsdc: number) =>
      tx(() =>
        writeContractAsync({
          address: VAULT_ADDR as `0x${string}`,
          abi: vaultAbi,
          functionName: 'withdraw',
          args: [toBase(amountUsdc)],
          chainId: 5042002,
        }),
      ),
    [tx, writeContractAsync],
  )

  return {
    address, chainId, readerAddress: reader,
    vaultBalance: vaultBalance == null ? null : fromBase(vaultBalance),
    walletUsdc: walletUsdc == null ? null : fromBase(walletUsdc),
    openRound, lockedRound, myBets, notice, pending,
    deposit, placeBet, claim, withdraw, refresh,
  }
}
