/**
 * Reports sealed to a passkey, with Mera.
 *
 * An audit of private code is itself sensitive: it says where the code breaks.
 * A sealed report is the Markdown report encrypted in the browser with a key
 * derived from the person's passkey (WebAuthn PRF, through Mera's secret
 * vault: HKDF to AES-256-GCM, a fresh salt per file). The file can sit in
 * email, a drive or a public repository; only the passkey that sealed it can
 * open it, at /open, and Monsmith never sees the key or the plaintext of the
 * sealed copy.
 *
 * This file is the format and the pure decisions around it. The passkey
 * ceremonies are in `sealWithPasskey` and `openWithPasskey`, which only run in
 * a browser.
 */

export const SEALED_FORMAT = 'monsmith.sealed-report';
export const SEALED_VERSION = 1;
const CREDENTIAL_KEY = 'monsmith.seal.credential';

/** What is visible without the passkey: enough to know what the file is, nothing about the findings. */
export interface SealedHeader {
    format: typeof SEALED_FORMAT;
    version: typeof SEALED_VERSION;
    reportId: string;
    title: string;
    sealedAt: string;
}

export interface SealedFile extends SealedHeader {
    /** Mera's passkey secret vault, as Mera serialises it. */
    vault: unknown;
}

/** The plaintext inside the vault. */
export interface SealedContent {
    reportId: string;
    title: string;
    markdown: string;
}

/**
 * The passkey's relying party: the registrable domain, so a passkey made on
 * www.monsmith.com also opens files on monsmith.com. Anywhere else (localhost,
 * a preview) the passkey is scoped to that host alone.
 */
export function relyingPartyId(hostname: string): string {
    return hostname === 'monsmith.com' || hostname.endsWith('.monsmith.com') ? 'monsmith.com' : hostname;
}

export function wrapSealed(header: Omit<SealedHeader, 'format' | 'version'>, vault: unknown): SealedFile {
    return { format: SEALED_FORMAT, version: SEALED_VERSION, ...header, vault };
}

/** Reads a sealed file's outer layer. Throws a readable error for anything that is not one. */
export function parseSealed(text: string): SealedFile {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        throw new Error('This is not a sealed Monsmith report.');
    }
    const file = value as Partial<SealedFile> | null;
    if (file === null || typeof file !== 'object' || file.format !== SEALED_FORMAT) throw new Error('This is not a sealed Monsmith report.');
    if (file.version !== SEALED_VERSION) throw new Error('This sealed report was made by a newer version of Monsmith.');
    if (typeof file.reportId !== 'string' || typeof file.title !== 'string' || typeof file.sealedAt !== 'string' || file.vault === undefined) {
        throw new Error('This sealed report is damaged.');
    }
    return file as SealedFile;
}

export function encodeContent(content: SealedContent): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(content));
}

export function decodeContent(bytes: Uint8Array): SealedContent {
    const content = JSON.parse(new TextDecoder().decode(bytes)) as Partial<SealedContent>;
    if (typeof content.markdown !== 'string' || typeof content.reportId !== 'string' || typeof content.title !== 'string') {
        throw new Error('This sealed report opened, but its contents are not a report.');
    }
    return content as SealedContent;
}

/** Turns Mera's error codes into something a person can act on. */
export function explainSealError(error: unknown): string {
    const code = typeof error === 'object' && error !== null && 'code' in error ? String((error as { code: unknown }).code) : '';
    switch (code) {
        case 'PRF_UNAVAILABLE':
            return 'This passkey cannot derive keys. In Chrome, save it to Google Password Manager rather than this Chrome profile; iCloud Keychain and 1Password also work.';
        case 'PASSKEY_OPERATION_FAILED':
            return 'The passkey prompt was cancelled or is not available here.';
        case 'DECRYPT_FAILED':
            return 'That passkey did not seal this report, so it cannot open it.';
        case 'VAULT_FORMAT_INVALID':
            return 'This sealed report is damaged.';
        default:
            return error instanceof Error ? error.message : 'Sealing failed.';
    }
}

interface StoredCredential {
    credentialId: string;
}

function rememberedCredential(): StoredCredential | null {
    try {
        const raw = window.localStorage.getItem(CREDENTIAL_KEY);
        const parsed = raw === null ? null : (JSON.parse(raw) as Partial<StoredCredential>);
        return parsed !== null && typeof parsed.credentialId === 'string' ? { credentialId: parsed.credentialId } : null;
    } catch {
        return null;
    }
}

function rememberCredential(vault: unknown): void {
    const credentialId = (vault as { credential?: { credentialId?: unknown } }).credential?.credentialId;
    if (typeof credentialId !== 'string') return;
    try {
        window.localStorage.setItem(CREDENTIAL_KEY, JSON.stringify({ credentialId }));
    } catch {
        // Only a convenience: without it the next seal asks which passkey to use.
    }
}

/**
 * Seals a report. Reuses the passkey this browser sealed with before, and
 * creates one the first time, so a person ends up with one Monsmith sealing
 * passkey rather than one per report.
 */
export async function sealWithPasskey(content: SealedContent, holder: string | null): Promise<SealedFile> {
    const { createSecretVaultWithExistingPasskey, createSecretVaultWithNewPasskey } = await import('@category-labs/mera');
    const rpId = relyingPartyId(window.location.hostname);
    const secret = encodeContent(content);
    const known = rememberedCredential();
    const vault =
        known !== null
            ? await createSecretVaultWithExistingPasskey({ rpId, credential: { credentialId: known.credentialId }, secret })
            : await createSecretVaultWithNewPasskey({
                  rp: { id: rpId, name: 'Monsmith' },
                  user: { name: holder ?? 'Monsmith sealed reports', displayName: 'Monsmith sealed reports' },
                  secret,
              });
    rememberCredential(vault);
    return wrapSealed({ reportId: content.reportId, title: content.title, sealedAt: new Date().toISOString() }, vault);
}

/** Opens a sealed report with the passkey that sealed it. */
export async function openWithPasskey(file: SealedFile): Promise<SealedContent> {
    const { decryptSecretVaultWithPasskey, parseSecretVault } = await import('@category-labs/mera');
    const vault = parseSecretVault(file.vault);
    const bytes = await decryptSecretVaultWithPasskey({ rpId: relyingPartyId(window.location.hostname), vault });
    return decodeContent(bytes);
}
