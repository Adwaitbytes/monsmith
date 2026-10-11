// Code generated — DO NOT EDIT.
import type { Address } from 'viem'
import { addContractMock, type ContractMock, type EvmMock } from '@chainlink/cre-sdk/test'

import { MonsmithVerdictsABI } from './MonsmithVerdicts'

export type MonsmithVerdictsMock = {
  attestations?: () => `0x${string}`
  getExpectedAuthor?: () => `0x${string}`
  getExpectedWorkflowId?: () => `0x${string}`
  getExpectedWorkflowName?: () => `0x${string}`
  getForwarderAddress?: () => `0x${string}`
  isConfirmed?: (sourceHash: `0x${string}`, minScore: number) => boolean
  owner?: () => `0x${string}`
  supportsInterface?: (interfaceId: `0x${string}`) => boolean
  verdictCount?: () => bigint
  verdictOf?: (sourceHash: `0x${string}`) => { score: number; reportMatches: boolean; verifiedAt: bigint; reportHash: `0x${string}` }
} & Pick<ContractMock<typeof MonsmithVerdictsABI>, 'writeReport'>

export function newMonsmithVerdictsMock(address: Address, evmMock: EvmMock): MonsmithVerdictsMock {
  return addContractMock(evmMock, { address, abi: MonsmithVerdictsABI }) as MonsmithVerdictsMock
}

