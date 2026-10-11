import {
	bytesToHex,
	consensusIdenticalAggregation,
	cre,
	getNetwork,
	type HTTPSendRequester,
	type Runtime,
	TxStatus,
} from '@chainlink/cre-sdk'
import { type Address, encodeAbiParameters, type Hex, parseAbiParameters } from 'viem'
import { z } from 'zod'
import { type AttestedDecoded, type DecodedLog, MonsmithAttestations } from '../contracts/evm/ts/generated/MonsmithAttestations'
import { MonsmithVerdicts } from '../contracts/evm/ts/generated/MonsmithVerdicts'

/**
 * A Chainlink DON's second opinion on every Monsmith attestation.
 *
 * Monsmith attests an audit on Monad mainnet under its ERC-8004 identity, which
 * is one party's word. This workflow reacts to each Attested event, confirms
 * against finalized chain state that the attestation is still the current one,
 * has every node independently ask whether the published report still hashes
 * to what was attested, and writes the agreed verdict to MonsmithVerdicts on
 * Monad through the Keystone forwarder. A contract that wants more than
 * Monsmith's word can then ask MonsmithVerdicts.isConfirmed.
 */

export const configSchema = z.object({
	chainSelectorName: z.string(),
	attestationsAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
	verdictsAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
	// A pattern, not z.url(): the workflow's WASM runtime has no URL parser.
	verifyUrl: z.string().regex(/^https:\/\/[^\s?#]+$/),
	gasLimit: z.string().regex(/^\d+$/),
})
export type Config = z.infer<typeof configSchema>

/** What each node concluded about the report behind an attestation. */
export type ReportCheck = 'intact' | 'altered' | 'unknown'

/** Reads one /api/verify answer. Exported for tests: it is the only judgement a node makes. */
export function judgeVerifyResponse(status: number, body: string, reportHash: Hex): ReportCheck {
	if (status !== 200) return 'unknown'
	let parsed: unknown
	try {
		parsed = JSON.parse(body)
	} catch {
		return 'unknown'
	}
	const answer = parsed as { attested?: unknown; reportMatches?: unknown; attestation?: { reportHash?: unknown } }
	// The verifier must be talking about the same attestation the chain holds.
	if (answer.attested !== true || typeof answer.attestation?.reportHash !== 'string') return 'unknown'
	if (answer.attestation.reportHash.toLowerCase() !== reportHash.toLowerCase()) return 'unknown'
	if (answer.reportMatches === true) return 'intact'
	if (answer.reportMatches === false) return 'altered'
	return 'unknown'
}

/** The report MonsmithVerdicts decodes: (sourceHash, score, reportHash, reportMatches). */
export function encodeVerdict(sourceHash: Hex, score: number, reportHash: Hex, intact: boolean): Hex {
	return encodeAbiParameters(parseAbiParameters('bytes32 sourceHash, uint8 score, bytes32 reportHash, bool reportMatches'), [
		sourceHash,
		score,
		reportHash,
		intact,
	])
}

const checkReport =
	(verifyUrl: string, sourceHash: Hex, reportHash: Hex) =>
	(requester: HTTPSendRequester): ReportCheck => {
		const response = requester
			.sendRequest({
				url: `${verifyUrl}?source=${sourceHash}`,
				method: 'GET',
				headers: { Accept: 'application/json' },
				// Nodes share one cached answer, so the verifier sees the check once.
				cacheSettings: { store: true, maxAge: '60s' },
			})
			.result()
		return judgeVerifyResponse(response.statusCode, new TextDecoder().decode(response.body), reportHash)
	}

function monad(config: Config) {
	const network = getNetwork({ chainFamily: 'evm', chainSelectorName: config.chainSelectorName, isTestnet: false })
	if (!network) throw new Error(`Network not found: ${config.chainSelectorName}`)
	return new cre.capabilities.EVMClient(network.chainSelector.selector)
}

export const onAttested = (runtime: Runtime<Config>, payload: DecodedLog<AttestedDecoded>): string => {
	const config = runtime.config
	const { sourceHash, score, reportHash } = payload.data
	runtime.log(`Attested ${sourceHash}: score ${score}, report ${reportHash}`)

	const evm = monad(config)
	const attestations = new MonsmithAttestations(evm, config.attestationsAddress as Address)

	// 1. The event may already be superseded by a re-audit; only the current
	//    attestation is worth a verdict, read at finalized depth.
	const current = attestations.ofSource(runtime, sourceHash)
	if (current.reportHash.toLowerCase() !== reportHash.toLowerCase()) {
		runtime.log(`Superseded: the current attestation's report is ${current.reportHash}. No verdict written.`)
		return `superseded ${sourceHash}`
	}

	// 2. Every node checks the published report on its own; they must agree.
	const check = new cre.capabilities.HTTPClient()
		.sendRequest(runtime, checkReport(config.verifyUrl, sourceHash, current.reportHash), consensusIdenticalAggregation<ReportCheck>())()
		.result()
	runtime.log(`DON consensus on the report: ${check}`)
	if (check === 'unknown') {
		// Writing "altered" for a verifier that was down would be a false accusation.
		return `undecided ${sourceHash}`
	}

	// 3. Deliver the signed verdict to Monad.
	const verdicts = new MonsmithVerdicts(evm, config.verdictsAddress as Address)
	const result = verdicts.writeReport(runtime, encodeVerdict(sourceHash, current.score, current.reportHash, check === 'intact'), {
		gasLimit: config.gasLimit,
	})
	if (result.txStatus !== TxStatus.SUCCESS) {
		throw new Error(`Verdict write failed: ${result.errorMessage || result.txStatus}`)
	}
	const tx = bytesToHex(result.txHash || new Uint8Array(32))
	runtime.log(`Verdict written to MonsmithVerdicts: ${check}, tx ${tx}`)
	return `${check} ${sourceHash} ${tx}`
}

export function initWorkflow(config: Config) {
	const attestations = new MonsmithAttestations(monad(config), config.attestationsAddress as Address)
	return [cre.handler(attestations.logTriggerAttested(), onAttested)]
}
