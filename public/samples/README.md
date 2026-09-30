# Reference contracts

The contracts the studio's start screen offers in one click. Each is the real
source at a pinned commit, copied unchanged with its original license header,
except The DAO, which is a rebuild (the original is Solidity 0.3 and no longer
compiles).

| Folder | Source | Commit | License |
| --- | --- | --- | --- |
| uniswap-v2 | github.com/Uniswap/v2-core | 6a9e7c97860676e0992f22a49665760444c1cdf5 | GPL-3.0 |
| uniswap-v3 | github.com/Uniswap/v3-core | d0831dc6b8a318df3872b6d68f6de135c9f3ec29 | BUSL-1.1, converted to GPL-2.0-or-later on 2023-04-01 |
| weth9 | github.com/gnosis/canonical-weth | 0dd1ea3e295eef916d0c6223ec63141137d22d67 | GPL-3.0 |
| compound-comp | github.com/compound-finance/compound-protocol | a3214f67b73310d547e00fc578e8355911c9d376 | BSD-3-Clause |
| the-dao | Rebuilt from github.com/slockit/DAO | n/a | MIT |

Test contracts are left out. `app/studio/referenceContracts.ts` lists the files
each one loads; regenerate it when a folder here changes.
