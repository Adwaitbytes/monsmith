import { describe, expect } from 'bun:test'
import { TxStatus } from '@chainlink/cre-sdk'
import { EvmMock, HttpActionsMock, newTestRuntime, test } from '@chainlink/cre-sdk/test'
import { decodeAbiParameters, parseAbiParameters, type Address, type Hex } from 'viem'
import { newMonsmithAttestationsMock } from '../contracts/evm/ts/generated/MonsmithAttestations_mock'
import { encodeVerdict, judgeVerifyResponse, onAttested } from './workflow'

const MONAD = 8481857512324358265n // monad-mainnet
const ATTESTATIONS = '0xfa57831Fcb96Effc1E36d41e44Cd0fb1aC16de77' as Address
const VERDICTS = '0x00000000000000000000000000000000000000Ab' as Address
const SOURCE = `0x${'11'.repeat(32)}` as Hex
const REPORT = `0x${'22'.repeat(32)}` as Hex
const OLDER = `0x${'33'.repeat(32)}` as Hex

const config = {
	chainSelectorName: 'monad-mainnet',
	attestationsAddress: ATTESTATIONS,
	verdictsAddress: VERDICTS,
	verifyUrl: 'https://www.monsmith.com/api/verify',
	gasLimit: '300000',
}

const payload = (reportHash: Hex) => ({
	topics: [],
	data: { sourceHash: SOURCE, chainId: 0n, target: '0x0000000000000000000000000000000000000000', score: 79, critical: 0, high: 0, reportHash, reportURI: 'https://www.monsmith.com/report/r1' },
})

const current = { score: 79, critical: 0, high: 0, medium: 3, low: 2, timestamp: 1n, reportHash: REPORT, reportURI: 'https://www.monsmith.com/report/r1' }

const verifyBody = (reportMatches: boolean | null, reportHash: Hex = REPORT) =>
	JSON.stringify({ attested: true, attestation: { reportHash, score: 79 }, reportMatches })

function runtimeWith() {
	const runtime = newTestRuntime()
	;(runtime as unknown as { config: typeof config }).config = config
	return runtime as never
}

describe('judgeVerifyResponse', () => {
	test('reads the verifier only when it talks about the same attestation', () => {
		expect(judgeVerifyResponse(200, verifyBody(true), REPORT)).toBe('intact')
		expect(judgeVerifyResponse(200, verifyBody(false), REPORT)).toBe('altered')
		expect(judgeVerifyResponse(200, verifyBody(null), REPORT)).toBe('unknown')
		expect(judgeVerifyResponse(200, verifyBody(true, OLDER), REPORT)).toBe('unknown')
		expect(judgeVerifyResponse(502, verifyBody(true), REPORT)).toBe('unknown')
		expect(judgeVerifyResponse(200, 'not json', REPORT)).toBe('unknown')
		expect(judgeVerifyResponse(200, JSON.stringify({ attested: false }), REPORT)).toBe('unknown')
	})

	test('the verdict encodes in the layout MonsmithVerdicts decodes', () => {
		const [source, score, reportHash, matches] = decodeAbiParameters(
			parseAbiParameters('bytes32, uint8, bytes32, bool'),
			encodeVerdict(SOURCE, 79, REPORT, true),
		)
		expect([source, score, reportHash, matches]).toEqual([SOURCE, 79, REPORT, true])
	})
})

describe('onAttested', () => {
	test('writes the DON verdict when every node finds the report intact', () => {
		const evm = EvmMock.testInstance(MONAD)
		newMonsmithAttestationsMock(ATTESTATIONS, evm).ofSource = () => current
		HttpActionsMock.testInstance().sendRequest = () => ({ statusCode: 200, body: new TextEncoder().encode(verifyBody(true)) })
		let written = false
		evm.writeReport = () => {
			written = true
			return { txStatus: TxStatus.SUCCESS, txHash: new Uint8Array(32) }
		}
		expect(onAttested(runtimeWith(), payload(REPORT) as never)).toStartWith('intact')
		expect(written).toBe(true)
	})

	test('records an altered report as such', () => {
		const evm = EvmMock.testInstance(MONAD)
		newMonsmithAttestationsMock(ATTESTATIONS, evm).ofSource = () => current
		HttpActionsMock.testInstance().sendRequest = () => ({ statusCode: 200, body: new TextEncoder().encode(verifyBody(false)) })
		evm.writeReport = () => ({ txStatus: TxStatus.SUCCESS, txHash: new Uint8Array(32) })
		expect(onAttested(runtimeWith(), payload(REPORT) as never)).toStartWith('altered')
	})

	test('writes nothing for an attestation a re-audit has replaced', () => {
		const evm = EvmMock.testInstance(MONAD)
		newMonsmithAttestationsMock(ATTESTATIONS, evm).ofSource = () => current
		evm.writeReport = () => {
			throw new Error('must not write')
		}
		expect(onAttested(runtimeWith(), payload(OLDER) as never)).toStartWith('superseded')
	})

	test('writes nothing when the verifier cannot answer, rather than accusing the report', () => {
		const evm = EvmMock.testInstance(MONAD)
		newMonsmithAttestationsMock(ATTESTATIONS, evm).ofSource = () => current
		HttpActionsMock.testInstance().sendRequest = () => ({ statusCode: 502, body: new Uint8Array() })
		evm.writeReport = () => {
			throw new Error('must not write')
		}
		expect(onAttested(runtimeWith(), payload(REPORT) as never)).toStartWith('undecided')
	})
})
