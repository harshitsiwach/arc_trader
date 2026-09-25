import { useCallback, useEffect, useState } from 'react'
import { useAccount, useWriteContract } from 'wagmi'
import { erc20Abi } from '../lib/onchain'
import {
  HBLK,
  VAULT,
  fromU6,
  fromWad,
  isStakingLive,
  stakeVaultAbi,
  stakingClient,
  toU6,
} from '../lib/staking'
import { USDC_ADDR } from '../lib/onchain'

export interface StakePosition {
  staked: number
  accrued: number
  unlockAt: number // unix seconds, 0 = nothing staked
  hblk: number
  tvl: number
  deployed: number
  // Raw values + fetch time for the client-side per-second projection.
  stakedRaw: bigint
  accruedRaw: bigint
  rateRaw: bigint
  fetchedAtMs: number
}

/** Earn mode: stake USDC, claim HBLK daily, 30-day lock, penalty exit. */
export function useStaking() {
  const { address, chainId } = useAccount()
  const [pos, setPos] = useState<StakePosition | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const { writeContractAsync } = useWriteContract()

  const refresh = useCallback(async () => {
    if (!address || !isStakingLive) return
    try {
      const who = address as `0x${string}`
      const [st, ac, un, tv, dp, hb, rate] = await Promise.all([
        stakingClient.readContract({ address: VAULT, abi: stakeVaultAbi, functionName: 'stakedBalance', args: [who] }) as Promise<bigint>,
        stakingClient.readContract({ address: VAULT, abi: stakeVaultAbi, functionName: 'accruedRewards', args: [who] }) as Promise<bigint>,
        stakingClient.readContract({ address: VAULT, abi: stakeVaultAbi, functionName: 'unlockTime', args: [who] }) as Promise<bigint>,
        stakingClient.readContract({ address: VAULT, abi: stakeVaultAbi, functionName: 'totalStaked' }) as Promise<bigint>,
        stakingClient.readContract({ address: VAULT, abi: stakeVaultAbi, functionName: 'totalDeployed' }) as Promise<bigint>,
        stakingClient.readContract({ address: HBLK, abi: erc20Abi, functionName: 'balanceOf', args: [who] }) as Promise<bigint>,
        stakingClient.readContract({ address: VAULT, abi: stakeVaultAbi, functionName: 'REWARD_RATE' }) as Promise<bigint>,
      ])
      setPos({
        staked: fromU6(st),
        accrued: fromWad(ac),
        unlockAt: Number(un),
        tvl: fromU6(tv),
        deployed: fromU6(dp),
        hblk: fromWad(hb),
        stakedRaw: st,
        accruedRaw: ac,
        rateRaw: rate,
        fetchedAtMs: Date.now(),
      })
    } catch (e) {
      setNotice(e instanceof Error ? e.message.slice(0, 160) : 'read failed')
    }
  }, [address])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 8000)
    return () => clearInterval(t)
  }, [refresh])

  const tx = useCallback(
    async (fn: () => Promise<`0x${string}`>) => {
      setNotice(null)
      setPending(true)
      try {
        const hash = await fn()
        await stakingClient.waitForTransactionReceipt({ hash })
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

  const stake = useCallback(
    (amountUsdc: number) =>
      tx(async () => {
        const amt = toU6(amountUsdc)
        await writeContractAsync({
          address: USDC_ADDR, abi: erc20Abi, functionName: 'approve',
          args: [VAULT, amt], chainId: 5042002,
        }).then((h) => stakingClient.waitForTransactionReceipt({ hash: h }))
        return writeContractAsync({
          address: VAULT, abi: stakeVaultAbi, functionName: 'stake',
          args: [amt], chainId: 5042002,
        })
      }),
    [tx, writeContractAsync],
  )

  const simple = useCallback(
    (fn: 'claimRewards' | 'earlyExit' | 'unstake') =>
      tx(() =>
        writeContractAsync({ address: VAULT, abi: stakeVaultAbi, functionName: fn, chainId: 5042002 }),
      ),
    [tx, writeContractAsync],
  )

  return { address, chainId, pos, notice, pending, stake, simple, refresh, isStakingLive }
}
