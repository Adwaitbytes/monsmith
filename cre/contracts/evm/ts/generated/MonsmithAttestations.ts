// Code generated — DO NOT EDIT.
import {
  decodeEventLog,
  decodeFunctionResult,
  encodeEventTopics,
  encodeFunctionData,
  zeroAddress,
} from 'viem'
import type { Address, Hex } from 'viem'
import {
  bytesToHex,
  encodeCallMsg,
  EVMClient,
  hexToBase64,
  LAST_FINALIZED_BLOCK_NUMBER,
  prepareReportRequest,
  type EVMLog,
  type Runtime,
} from '@chainlink/cre-sdk'

export interface DecodedLog<T> extends Omit<EVMLog, 'data'> { data: T }

const encodeTopicValue = (t: Hex | Hex[] | null): string[] => {
  if (t == null) return []
  if (Array.isArray(t)) return t.map(hexToBase64)
  return [hexToBase64(t)]
}





/**
 * Filter params for Attested. Only indexed fields can be used for filtering.
 * Indexed string/bytes must be passed as keccak256 hash (Hex).
 */
export type AttestedTopics = {
  sourceHash?: `0x${string}`
  chainId?: bigint
  target?: `0x${string}`
}

/**
 * Decoded Attested event data.
 */
export type AttestedDecoded = {
  sourceHash: `0x${string}`
  chainId: bigint
  target: `0x${string}`
  score: number
  critical: number
  high: number
  reportHash: `0x${string}`
  reportURI: string
}


export const MonsmithAttestationsABI = [{"inputs":[{"internalType":"contractIAgentIdentity","name":"registry","type":"address"},{"internalType":"uint256","name":"agent","type":"uint256"}],"stateMutability":"nonpayable","type":"constructor"},{"inputs":[],"name":"EmptySource","type":"error"},{"inputs":[{"internalType":"address","name":"caller","type":"address"},{"internalType":"address","name":"owner","type":"address"}],"name":"NotAgentOwner","type":"error"},{"inputs":[],"name":"NotAttested","type":"error"},{"inputs":[{"internalType":"uint8","name":"score","type":"uint8"}],"name":"ScoreOutOfRange","type":"error"},{"anonymous":false,"inputs":[{"indexed":true,"internalType":"bytes32","name":"sourceHash","type":"bytes32"},{"indexed":true,"internalType":"uint256","name":"chainId","type":"uint256"},{"indexed":true,"internalType":"address","name":"target","type":"address"},{"indexed":false,"internalType":"uint8","name":"score","type":"uint8"},{"indexed":false,"internalType":"uint16","name":"critical","type":"uint16"},{"indexed":false,"internalType":"uint16","name":"high","type":"uint16"},{"indexed":false,"internalType":"bytes32","name":"reportHash","type":"bytes32"},{"indexed":false,"internalType":"string","name":"reportURI","type":"string"}],"name":"Attested","type":"event"},{"inputs":[],"name":"agentId","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes32","name":"sourceHash","type":"bytes32"},{"internalType":"uint256","name":"chainId","type":"uint256"},{"internalType":"address","name":"target","type":"address"},{"internalType":"uint8","name":"score","type":"uint8"},{"internalType":"uint16","name":"critical","type":"uint16"},{"internalType":"uint16","name":"high","type":"uint16"},{"internalType":"uint16","name":"medium","type":"uint16"},{"internalType":"uint16","name":"low","type":"uint16"},{"internalType":"bytes32","name":"reportHash","type":"bytes32"},{"internalType":"string","name":"reportURI","type":"string"}],"name":"attest","outputs":[],"stateMutability":"nonpayable","type":"function"},{"inputs":[],"name":"attestationCount","outputs":[{"internalType":"uint256","name":"","type":"uint256"}],"stateMutability":"view","type":"function"},{"inputs":[],"name":"identityRegistry","outputs":[{"internalType":"contractIAgentIdentity","name":"","type":"address"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes32","name":"sourceHash","type":"bytes32"}],"name":"isAttested","outputs":[{"internalType":"bool","name":"","type":"bool"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"uint256","name":"chainId","type":"uint256"},{"internalType":"address","name":"target","type":"address"}],"name":"ofDeployment","outputs":[{"internalType":"bytes32","name":"sourceHash","type":"bytes32"},{"components":[{"internalType":"uint8","name":"score","type":"uint8"},{"internalType":"uint16","name":"critical","type":"uint16"},{"internalType":"uint16","name":"high","type":"uint16"},{"internalType":"uint16","name":"medium","type":"uint16"},{"internalType":"uint16","name":"low","type":"uint16"},{"internalType":"uint64","name":"timestamp","type":"uint64"},{"internalType":"bytes32","name":"reportHash","type":"bytes32"},{"internalType":"string","name":"reportURI","type":"string"}],"internalType":"structMonsmithAttestations.Attestation","name":"attestation","type":"tuple"}],"stateMutability":"view","type":"function"},{"inputs":[{"internalType":"bytes32","name":"sourceHash","type":"bytes32"}],"name":"ofSource","outputs":[{"components":[{"internalType":"uint8","name":"score","type":"uint8"},{"internalType":"uint16","name":"critical","type":"uint16"},{"internalType":"uint16","name":"high","type":"uint16"},{"internalType":"uint16","name":"medium","type":"uint16"},{"internalType":"uint16","name":"low","type":"uint16"},{"internalType":"uint64","name":"timestamp","type":"uint64"},{"internalType":"bytes32","name":"reportHash","type":"bytes32"},{"internalType":"string","name":"reportURI","type":"string"}],"internalType":"structMonsmithAttestations.Attestation","name":"attestation","type":"tuple"}],"stateMutability":"view","type":"function"}] as const

export class MonsmithAttestations {
  constructor(
    private readonly client: EVMClient,
    public readonly address: Address,
  ) {}

  agentId(
    runtime: Runtime<unknown>,
  ): bigint {
    const callData = encodeFunctionData({
      abi: MonsmithAttestationsABI,
      functionName: 'agentId' as const,
    })

    const result = this.client
      .callContract(runtime, {
        call: encodeCallMsg({ from: zeroAddress, to: this.address, data: callData }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result()

    return decodeFunctionResult({
      abi: MonsmithAttestationsABI,
      functionName: 'agentId' as const,
      data: bytesToHex(result.data),
    }) as bigint
  }

  attestationCount(
    runtime: Runtime<unknown>,
  ): bigint {
    const callData = encodeFunctionData({
      abi: MonsmithAttestationsABI,
      functionName: 'attestationCount' as const,
    })

    const result = this.client
      .callContract(runtime, {
        call: encodeCallMsg({ from: zeroAddress, to: this.address, data: callData }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result()

    return decodeFunctionResult({
      abi: MonsmithAttestationsABI,
      functionName: 'attestationCount' as const,
      data: bytesToHex(result.data),
    }) as bigint
  }

  identityRegistry(
    runtime: Runtime<unknown>,
  ): `0x${string}` {
    const callData = encodeFunctionData({
      abi: MonsmithAttestationsABI,
      functionName: 'identityRegistry' as const,
    })

    const result = this.client
      .callContract(runtime, {
        call: encodeCallMsg({ from: zeroAddress, to: this.address, data: callData }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result()

    return decodeFunctionResult({
      abi: MonsmithAttestationsABI,
      functionName: 'identityRegistry' as const,
      data: bytesToHex(result.data),
    }) as `0x${string}`
  }

  isAttested(
    runtime: Runtime<unknown>,
    sourceHash: `0x${string}`,
  ): boolean {
    const callData = encodeFunctionData({
      abi: MonsmithAttestationsABI,
      functionName: 'isAttested' as const,
      args: [sourceHash],
    })

    const result = this.client
      .callContract(runtime, {
        call: encodeCallMsg({ from: zeroAddress, to: this.address, data: callData }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result()

    return decodeFunctionResult({
      abi: MonsmithAttestationsABI,
      functionName: 'isAttested' as const,
      data: bytesToHex(result.data),
    }) as boolean
  }

  ofDeployment(
    runtime: Runtime<unknown>,
    chainId: bigint,
    target: `0x${string}`,
  ): readonly [`0x${string}`, { score: number; critical: number; high: number; medium: number; low: number; timestamp: bigint; reportHash: `0x${string}`; reportURI: string }] {
    const callData = encodeFunctionData({
      abi: MonsmithAttestationsABI,
      functionName: 'ofDeployment' as const,
      args: [chainId, target],
    })

    const result = this.client
      .callContract(runtime, {
        call: encodeCallMsg({ from: zeroAddress, to: this.address, data: callData }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result()

    return decodeFunctionResult({
      abi: MonsmithAttestationsABI,
      functionName: 'ofDeployment' as const,
      data: bytesToHex(result.data),
    }) as readonly [`0x${string}`, { score: number; critical: number; high: number; medium: number; low: number; timestamp: bigint; reportHash: `0x${string}`; reportURI: string }]
  }

  ofSource(
    runtime: Runtime<unknown>,
    sourceHash: `0x${string}`,
  ): { score: number; critical: number; high: number; medium: number; low: number; timestamp: bigint; reportHash: `0x${string}`; reportURI: string } {
    const callData = encodeFunctionData({
      abi: MonsmithAttestationsABI,
      functionName: 'ofSource' as const,
      args: [sourceHash],
    })

    const result = this.client
      .callContract(runtime, {
        call: encodeCallMsg({ from: zeroAddress, to: this.address, data: callData }),
        blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
      })
      .result()

    return decodeFunctionResult({
      abi: MonsmithAttestationsABI,
      functionName: 'ofSource' as const,
      data: bytesToHex(result.data),
    }) as { score: number; critical: number; high: number; medium: number; low: number; timestamp: bigint; reportHash: `0x${string}`; reportURI: string }
  }

  writeReportFromAttest(
    runtime: Runtime<unknown>,
    sourceHash: `0x${string}`,
    chainId: bigint,
    target: `0x${string}`,
    score: number,
    critical: number,
    high: number,
    medium: number,
    low: number,
    reportHash: `0x${string}`,
    reportURI: string,
    gasConfig?: { gasLimit?: string },
  ) {
    const callData = encodeFunctionData({
      abi: MonsmithAttestationsABI,
      functionName: 'attest' as const,
      args: [sourceHash, chainId, target, score, critical, high, medium, low, reportHash, reportURI],
    })

    const reportResponse = runtime
      .report(prepareReportRequest(callData))
      .result()

    return this.client
      .writeReport(runtime, {
        receiver: this.address,
        report: reportResponse,
        gasConfig,
      })
      .result()
  }

  writeReport(
    runtime: Runtime<unknown>,
    callData: Hex,
    gasConfig?: { gasLimit?: string },
  ) {
    const reportResponse = runtime
      .report(prepareReportRequest(callData))
      .result()

    return this.client
      .writeReport(runtime, {
        receiver: this.address,
        report: reportResponse,
        gasConfig,
      })
      .result()
  }

  /**
   * Creates a log trigger for Attested events.
   * The returned trigger's adapt method decodes the raw log into AttestedDecoded,
   * so the handler receives typed event data directly.
   * When multiple filters are provided, topic values are merged with OR semantics (match any).
   */
  logTriggerAttested(
    filters?: AttestedTopics[],
  ) {
    let topics: { values: string[] }[]
    if (!filters || filters.length === 0) {
      const encoded = encodeEventTopics({
        abi: MonsmithAttestationsABI,
        eventName: 'Attested' as const,
      })
      topics = encoded.map((t) => ({ values: encodeTopicValue(t) }))
    } else if (filters.length === 1) {
      const f = filters[0]
      const args = {
        sourceHash: f.sourceHash,
        chainId: f.chainId,
        target: f.target,
      }
      const encoded = encodeEventTopics({
        abi: MonsmithAttestationsABI,
        eventName: 'Attested' as const,
        args,
      })
      topics = encoded.map((t) => ({ values: encodeTopicValue(t) }))
    } else {
      const allEncoded = filters.map((f) => {
        const args = {
          sourceHash: f.sourceHash,
          chainId: f.chainId,
          target: f.target,
        }
        return encodeEventTopics({
          abi: MonsmithAttestationsABI,
          eventName: 'Attested' as const,
          args,
        })
      })
      topics = allEncoded[0].map((_, i) => ({
        values: [...new Set(allEncoded.flatMap((row) => encodeTopicValue(row[i])))],
      }))
    }
    const baseTrigger = this.client.logTrigger({
      addresses: [hexToBase64(this.address)],
      topics,
    })
    const contract = this
    return {
      capabilityId: () => baseTrigger.capabilityId(),
      method: () => baseTrigger.method(),
      outputSchema: () => baseTrigger.outputSchema(),
      configAsAny: () => baseTrigger.configAsAny(),
      adapt: (rawOutput: EVMLog): DecodedLog<AttestedDecoded> => contract.decodeAttested(rawOutput),
    }
  }

  /**
   * Decodes a log into Attested data, preserving all log metadata.
   */
  decodeAttested(log: EVMLog): DecodedLog<AttestedDecoded> {
    const decoded = decodeEventLog({
      abi: MonsmithAttestationsABI,
      data: bytesToHex(log.data),
      topics: log.topics.map((t) => bytesToHex(t)) as [Hex, ...Hex[]],
    })
    const { data: _, ...rest } = log
    return { ...rest, data: decoded.args as unknown as AttestedDecoded }
  }
}

