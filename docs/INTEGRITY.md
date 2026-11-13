# ZombieCoder Integrity Manifest

> **কী:** repo-র source, scripts, tests, skills, `package.json` ও `LICENSE`-এর
> SHA-256 manifest। **কেন:** accidental বা unauthorized change ধরা। **সীমা:**
> এটা legal identity signature নয় — যে repo edit করতে পারে, সে manifest-ও
> regenerate করতে পারে।

```text
╔══════════════════════════════════════════════════════════════════════════╗
║  root  bb165ff27df0bac06bd7842ac6a9e14551f42b8de5f4e320d9c88916dad6ed42  ║
║  files 148 · bytes 1387221 · base beac29a · dirty                        ║
╚══════════════════════════════════════════════════════════════════════════╝
```

| Field | Value |
|---|---|
| Schema | `zombiecoder-integrity/v1` |
| Generated (UTC) | `2026-11-13T17:53:50.571Z` |
| Base commit | `beac29a` |
| Branch | `main` |
| Code tree | `dirty` |
| Files | 148 |
| Bytes | 1387221 |
| Root SHA-256 | `bb165ff27df0bac06bd7842ac6a9e14551f42b8de5f4e320d9c88916dad6ed42` |

## Scope

- `src`
- `bin`
- `scripts`
- `test`
- `mcp`
- `docs/skills`
- `install.sh`
- `package.json`
- `LICENSE`

## Verify

```bash
npm run integrity:check
```

`--check` কোনো file লেখে না; mismatch হলে exit code `1` দেয়।

## Files

| Path | Bytes | SHA-256 |
|---|---:|---|
| `bin/install.mjs` | 87620 | `086f76a17df297a99535502fa0ddb9f9aad4ce221a2188f7cad27a2b4f57ad03` |
| `bin/quick-install.mjs` | 5641 | `c6847f6d2dae8c70dfb2f03d665784e2f382884585a1f6e140b232dc8432bfcc` |
| `docs/skills/bootstrap.md` | 574 | `0580d9dff2bf4a466597b5dcb41792ba7bba22175e37ff95dfa716acb057e51c` |
| `docs/skills/cpanel.md` | 1867 | `f056fa581f9a0fa268556d8769fc2c5389a864fbd552e90b1692efde0c003537` |
| `docs/skills/evidence-before-confidence.md` | 3140 | `6f05dd0fc50a97fb8d0eaf77be0f68aee5ee4760847e98a7d3ca3ffb51fe21f7` |
| `docs/skills/fastapi.md` | 1655 | `336760d1a90ba33630224332e9da615b214d3ec627095be9ced772a4fbfb3d34` |
| `docs/skills/first-principles.md` | 1752 | `a6081c550298eb25bbb9d887be98e642a7a4f239ece4b9c8b3cec9865297db3a` |
| `docs/skills/laravel-market.md` | 4175 | `4fa4ae4e951967bfa750d417dc67e16b41c478b48035a1e34d62b065d8475fac` |
| `docs/skills/laravel.md` | 1910 | `51b883d978bb3413e243cee90e00db1e25a6b200fd0eaf38d4576aedbb079dec` |
| `docs/skills/llama-cpu.md` | 576 | `349dbaa66d650c820595498287f3799ac9efb39b11b7391f8680103e84380aef` |
| `docs/skills/next.md` | 1669 | `afdf6e2a125f8f9db4357c2d11375dd76f2d3b6d75fe3cf21550c105d6b6d254` |
| `docs/skills/node.md` | 1392 | `44a57ebd465774ec2dba3a736e27c24b4e0dd8370ee5a3ada1a642d5a3301f27` |
| `docs/skills/ollama.md` | 512 | `81dfb0ff1ba9b7596304e63c3e8b6ccbde844ea8ca6bfd7f79012795b4053813` |
| `docs/skills/python-regex.md` | 3759 | `c3afda66297c80485974f66c4212eec935bfccd4431c75c6c6f2210e1406aa95` |
| `docs/skills/python.md` | 1435 | `1fbd7bf69b3ee47b25c0ce08222989be4f2c74ce008f3702b7f913e584cf3b86` |
| `docs/skills/resource-optimization.md` | 1624 | `4180017cb251d46c33afae2b19b44d83ce7f52f6b315b3d0d5e0bd2bb182500e` |
| `docs/skills/scrape-verify.md` | 3098 | `2234c0e92c4ee379cf1268d6f2f62fbf12a1443f73f30f0d36a9f1b41671ef8d` |
| `docs/skills/server.md` | 1685 | `0149a648a6e8b4d8104097986e6796ceb224433707f5e73c281de5e7577eb4e3` |
| `docs/skills/tailwind.md` | 595 | `d89971988125a3d5cc457034e172ca54d758d03c277e9a8b57554b7d06e38e1b` |
| `docs/skills/typescript.md` | 638 | `07d314e2ab542bbfe39b5fdcfd1e4f8ebc255b61ca989c3f9970608e1095cc5e` |
| `docs/skills/uiux-delivery.md` | 3952 | `c2a66f4f4f3edbee5135b6e4b05ef82165f35baf1f9a7138c0d0f0d268394e15` |
| `docs/skills/web-delivery.md` | 4247 | `61ce13fc7897d4cb1a7bd59cfaa058ef6d94d6d7e7cb34295b179bc7e72cf0db` |
| `install.sh` | 35979 | `ff0360eb53837699276db350f5427d5d615f4c2cc252b83b0cc4275ce5d683da` |
| `LICENSE` | 1961 | `d06b8b22307bf25fa4e3dba778ad2ccc1350c2e5cd1b5e6ed40c2de25b6cd95a` |
| `mcp/image-brand/e2e-live.mjs` | 2781 | `8ae7c8c7ce022cbb80f049d56aeec5719dfc69cc90ee87c3aed8006454ebc04f` |
| `mcp/image-brand/fixtures.py` | 1731 | `bee4ffeed922dafa6a11c47dfca4ff1c9e647dbf12038cc8cff3d6d31ff1ea44` |
| `mcp/image-brand/mcp-client.mjs` | 296 | `131a4fcb5d60dff790af5ba3aaedd9d919cea7ea96140e73c4d616947925fbd6` |
| `mcp/image-brand/pipeline.py` | 26973 | `8c358d461af230b12a6a05af3696fb320e08d1ad6f6d4101e9dd231f2f433d0c` |
| `mcp/image-brand/README.md` | 9487 | `ff977c0a815c52d7529a18d05422d4c26eeb941aeeca1416181049feb2da3ba5` |
| `mcp/image-brand/selfcheck.mjs` | 3386 | `d57ffb1a1205eaa301eb9d067b10093e51aa3a7f96c61987a16dab12f1a0ae3c` |
| `mcp/image-brand/server.mjs` | 46302 | `732d101c9df2739b3b81e30cb799ac371b4fc93d1ea89421b2fad0157dd60847` |
| `mcp/image-brand/test/image-brand.test.mjs` | 6621 | `c4613c3755ccbdfdd1f34306947fe55bf0b1f14f184c7c0b018772308714176e` |
| `mcp/public-api/README.md` | 4109 | `750438f9e795c5d1676a71eb7495e3e3146180258766445eca8f5f2f51ab1bae` |
| `mcp/public-api/selfcheck.mjs` | 2649 | `cd5083dbd0126e4f641c54f1d715c3ac6c48f6434a87ee5516cc9e3ed226f58f` |
| `mcp/public-api/server.mjs` | 3188 | `709ded85e81ecfb16c9df0650735e22a7bc9327383be133720e72c0e3bd54e3e` |
| `mcp/public-api/sources.mjs` | 17211 | `bd18b936496f7cc34e390f2d3f8b5ac54a8cf412e7d447e40b42b26868ad55fc` |
| `mcp/public-api/test/public-api.test.mjs` | 3599 | `eb0ffc399dfab82869c693130792b2da6c911e27126cffc8f4fbd5619c26ebd1` |
| `mcp/shared/client.mjs` | 2609 | `acc65207ae92b58082f2ff1df8570d076c710b5303a6ea7fe51f6ac1a62c088c` |
| `package.json` | 2454 | `fe75c51a2a1efe7f1d15115500055f2575fac828037c8e7f2f1c770ddd7e42b3` |
| `scripts/agents-check.mjs` | 6808 | `b7f71c2350aaf9a9b42652907ee204fe673baac6b0164473cba87f70cd50ef3f` |
| `scripts/allow-always-check.mjs` | 3138 | `514642a97a4f3a3a3f67b68789d8b2e1665680d2623e79d14ba640c6d395c257` |
| `scripts/audit-install.mjs` | 5982 | `99d67513dc9f47c3942fd7a9122801d3e58614d02a4e132bff43957b3c848bf5` |
| `scripts/configure.mjs` | 14570 | `53c62929b01c0cc5bddc1a21935e88790c6f67a8d5b7989711b894a6da0faf18` |
| `scripts/docs-check.mjs` | 779 | `391e4b5f418b6357a67bba6019b2c2818fb3e86889a4eaba0722dc49802917e7` |
| `scripts/e2e-install.mjs` | 14358 | `a6aded4609362a02aa239f8a632d6c02c1fdd61decad1fe7c2054ff7eea3761b` |
| `scripts/e2e-modules.mjs` | 10876 | `ef1396e87669b2e833eae4685974b421266aa988d34d72403c460653e77bfa03` |
| `scripts/identity.mjs` | 4840 | `6cd9ec01f95af6a376745b4db047abd8ae77e5867fd5d6a91a99c82f1033f32d` |
| `scripts/integrity.mjs` | 10479 | `365f6335c685680a0062f86ea27ee3f10c3181662216a5e9d4ac2cc5a149983a` |
| `scripts/lsp-diagnostics.mjs` | 8920 | `9ee3431929bf4fec4e39d822e0a1876380229fda3408b7fa8c2f326a51ab4121` |
| `scripts/lsp-probe.mjs` | 7294 | `77f7d44d6529d2d73376c4ca09053c046d3209af0b90ec1da5fda2335c4fe7ae` |
| `scripts/modes-check.mjs` | 4341 | `0135f1f8fd3ef2c076c4be85f0b7ece12e36f5478c0ba88a34db7e40306557c5` |
| `scripts/setup.mjs` | 12763 | `57420239b7df1f9401c70fba2bc3377a3b0b8f1ef49e2d6a1a8f1786b0ea45c4` |
| `src/agents.ts` | 13479 | `0e9fc2b22e375579fb2e77d8772717aec58cf31bd0bad91795cbd0dd4b46574e` |
| `src/agents/base.ts` | 8318 | `a03474c4beb11e3d51e5f5cac67dd98062f83d744da97ceb22b478858ff70925` |
| `src/agents/brishti.ts` | 1905 | `1a894e846c733aac9c61b3c22b7d5f3254dc3063bdd0b604b2e697763f087de5` |
| `src/agents/defaults.ts` | 3986 | `6e2a53dfd779a0e7fb31ba332f3530c54760ca73b6ceb56b93162ba13b9895e3` |
| `src/agents/halim.ts` | 1935 | `2ddc0f5097e4d703b0e64548f4e6e1f930ec2e0dcfa6b5743ab117421e5ec83f` |
| `src/agents/index.ts` | 4509 | `245c6de43f295d406536b2bfb48f414781f7345d55dd16c55039ed067e538aac` |
| `src/agents/jarin.ts` | 1650 | `ff791ee47845d672a9dc86754d6f046a57e6b919395246015b8ed97241a6f603` |
| `src/agents/majnu.ts` | 1820 | `d3f0aa732c87dadd00cac7866b19e4a08440e5d56e86066e5d0ee79334f3e61a` |
| `src/agents/manu.ts` | 1781 | `04d229ac7298a076a5db7673d8bf0a76cfe5d6cf8931ef9f64f5570a03c8aeca` |
| `src/agents/nila.ts` | 2242 | `c18bfb99f7333607e89de8cc8ea7258ec399df4a9d2169e5cbed2d1a4c710446` |
| `src/agents/rashed.ts` | 1748 | `75fe74123f35f4f3e447ffab619d19b20aa6be3dce4e6931db9645ec3f6e83b3` |
| `src/agents/route.ts` | 10258 | `df46cd3837e7a6d6d330560e781ec53b552b4167dafce4e2cb5b55d5cc4d81a1` |
| `src/agents/runtime.ts` | 8462 | `145bb7ed2e92b66c0b8d7a94de0382cc8aca4324f214269485eb7d7245feb449` |
| `src/agents/shared.ts` | 6431 | `0c6aa523708af207a7d2713e8cde0b49ecb84c539d53ca8921df7769e76be6ae` |
| `src/agents/tuhin.ts` | 1964 | `9ff9a03166f09d8909ae2da277e30d62fd0f81e1f6deb68f8f103d811a031f14` |
| `src/agents/turn.ts` | 2848 | `36ef7e546f9c8131ab2780af0b8c29ace3082b676b13bd885ef7e9b11bcab0ac` |
| `src/agents/types.ts` | 3242 | `2e85269397c5277ac1004810358895cc7820bf32e9b40f06e4d51a02376f5688` |
| `src/agents/zombiecoder.ts` | 2380 | `da0185cb6f028e3c2b112c44c0029597f269dcf31300ab48cb384b48213975ea` |
| `src/ethics.ts` | 12749 | `ff044cef999a1cc0c8eb0deb06d6bfaffd06de5504bc1f3837753db38a78db67` |
| `src/generate.ts` | 6956 | `a908cccdca29b6cad134f07873e83bf86ce9b45d107a4d21a27708c581ed9a3c` |
| `src/identity.ts` | 11767 | `e0a07f913823045857b811ed7cf87e9bc34172cd0fb0662ce75a92691cc49ffd` |
| `src/install/space.ts` | 3813 | `098fe34dfe34003f1ad66cb1e6aa32f4ef8415bc9d81f198c61776fbd31f4931` |
| `src/plugin.ts` | 99562 | `a1bd017aa426b599fd83158b5a21fa5ede15f0516895c4ad36a64be7c88227bb` |
| `src/roster.ts` | 10259 | `c77ed9c1fcadc658411915fad178780a2847fcd2ca3e5dbb524ebe0564fb3cd8` |
| `src/runtime.ts` | 16007 | `e1abe71ca259e56f6465d9a4e884e645901bd234007cd71664feb6b72b43b567` |
| `src/zombie/circuitBreaker.ts` | 8526 | `a786855b8c6146dacc4d366976516883456d1c2644094cc773c70c4c63a0dba7` |
| `src/zombie/context.ts` | 19736 | `0fe0f500b0f844c9771ea6206112b9663415caa4689719a0585973fcd1ba095e` |
| `src/zombie/defaults.ts` | 3435 | `d77ae2c7532edcf8cb954d5eafb94782c39ec2ebc66b0f0d992639097362cec1` |
| `src/zombie/design.ts` | 13478 | `7374301b4ebc6d5754456c7396cc85ee7cda6c599aa8c2d8a3c4e4cc7a83d3d0` |
| `src/zombie/docsConsistency.ts` | 4738 | `5bd0126df48e12257d027e27f42e43f49409a8d8ef312db1840722f97291559f` |
| `src/zombie/focus.ts` | 13450 | `83b95b0216e699fda9047cad4ce854de8fd9c22182d174fa800f0f6ff411b14b` |
| `src/zombie/frontmatter.ts` | 10771 | `97a5c91c10c8edf838b7e6d47ad2549874885c0316254c3457434ceff0f07b16` |
| `src/zombie/goalContract.ts` | 13607 | `e713487a6419eeaad0f4c0d5b271b5b4f96072d7c73e1912b4e71e22cc8f73d1` |
| `src/zombie/intent.ts` | 2223 | `574e14ec8873c37b98766452b9cfb3c6c236200bb2d5eeec5e014638c9263082` |
| `src/zombie/investigation.ts` | 4662 | `21b43b83a6cab15f26feeaa3471ddcb06cb05384387b736667d63bdd26ff1c79` |
| `src/zombie/io.ts` | 5006 | `89b3f44e558f7b7d07735a9ac0a1fc3f610794c2ac10f50d3e7cd19b379d5dad` |
| `src/zombie/lsp.ts` | 13112 | `4ad4e476d20812de3f93bb8182d535cd3e1ed2764a8e117083daa9511cb25604` |
| `src/zombie/lspConfig.ts` | 7794 | `afcb29b0335f0d693780057eedb9db4f37310b4dddde1b083d5b972f0bf7f66b` |
| `src/zombie/mcp.ts` | 5564 | `2222d1adb6307c9767ac7392457acd25cf991c9130559825cc5ab383d6503b8a` |
| `src/zombie/mcpConfig.ts` | 3171 | `75b82836105f6d2fe16a42d90c2de5c72efd7043b5e5f127243f6769e15baaf8` |
| `src/zombie/memory.ts` | 13665 | `6b2a6a52ad2965b37bfcc605872baef24f2701619835d96a3c6677dd1b3c7973` |
| `src/zombie/models.ts` | 18470 | `670a8a798dbd6e75a34ee911e409369a27e875312e564531282145510e077c50` |
| `src/zombie/modes.ts` | 11206 | `3b257382796415773efae4b7fd372c2ef11e25e3523d5403b12f21d867a75eab` |
| `src/zombie/onboarding.ts` | 13844 | `7ee49c13c790326ae8d148e5a5ece209fa0a1c145ddd544b5e69a085ae7e1591` |
| `src/zombie/opencodeRuntime.ts` | 3884 | `1a4e01058f31e2cbfea9a1bfa456944fec8e70c9f338249b2033cf0d19cd14d9` |
| `src/zombie/origin.ts` | 5116 | `6b37139ebcf59a436a05e3fb3eb28be4ad4aa195a099fe388faab9030d73567c` |
| `src/zombie/paths.ts` | 4422 | `8ccc6064f994237523070fba137e14f7f579e791002b76fe1c82d25b90e03710` |
| `src/zombie/projectProfile.ts` | 4478 | `ac96ad9939aa05bb736f03e508ed2bb7c7ac5d068064261ffc17f94abe838a3b` |
| `src/zombie/responseGate.ts` | 39063 | `d2d5d725428a49dd9c9f8a20230e817676089f4627f7af2182e1ae27c2ee279f` |
| `src/zombie/runnerIdentity.ts` | 7631 | `7926e5533c287e0f757acd15623d4f0825a6eefa488379243059fd1f8ad659bc` |
| `src/zombie/sanitize.ts` | 3325 | `c65236840a4e8b9f460149d3209f995171aa3535840e8882239ca2496d5a9ac5` |
| `src/zombie/scan.ts` | 8082 | `3c5e756fede3cbf06fccdacb1f4606efd15f3b86a624c42a570b25473dbff081` |
| `src/zombie/server.ts` | 79623 | `b5d106dd1204bfdea9bc8b29b2b6cbe3963aa52de4638af0271d42792f581b53` |
| `src/zombie/shellGuard.ts` | 7546 | `5c77f8a4cb8395c8795dd80411b1553a884fda5c4c3f2c7de0738ce7b4a2687c` |
| `src/zombie/skillCatalog.ts` | 23840 | `abb0ad8dbfa0ded08f3c2631da78deb2065ddc005c9f30acca7f43cb014b0325` |
| `src/zombie/skills.ts` | 5815 | `0140442c49dfbe9ad7d02db80d310e314f5e126d9441dd33c4d6371894cba3d3` |
| `src/zombie/ssot.ts` | 8026 | `f75f84fcff719115775c985fed8adacf6e4cb6f5f1c3c9e46e95de10bf60b857` |
| `src/zombie/syllabus.ts` | 11725 | `2ec69619f8435234023ca5a194efc287934f45c7ff7ac923a1ddc7f0e48e244d` |
| `src/zombie/transform.ts` | 3964 | `1c25f3eb1f6ecc9c8ed68b9894f2dfcffb75e233540be06b81f8bda78cc11ba2` |
| `src/zombie/watchdog.ts` | 8617 | `4eb7c12c28bc6080ef224f2cc4acbc71fbf42812a46bfd69a73b65f6eedb8a57` |
| `test/agents.test.ts` | 14950 | `c9a7e092c3e6a82a580ac2a1fdbce75728df999394e95437a60f9159e36fb9ae` |
| `test/audit-install.test.ts` | 4155 | `78ac9b2a258dba24cc55474ec8d03baf2ef4c66d1797e272717c0b369cfd8d44` |
| `test/circuitBreaker.test.ts` | 5040 | `075d02b09d49f19206b242d8373dfac79413d90ac6211043b99b06814d5b1acb` |
| `test/context.test.ts` | 36898 | `a7f32365543fbec6b1e0a397c9a1ac3d4881e14701a89dbf7d52c91eb6fb8374` |
| `test/design.test.ts` | 4799 | `ce13246055690ddf813e9cc07cd6f108731b4cdd9d762f92941ea88d1b306e23` |
| `test/docs.test.ts` | 3227 | `d3d6f18053c2561701291a4b03e38cc00d96b31fcecfdec5fdc0c0a58cd5f85a` |
| `test/focus.test.ts` | 4051 | `47d93d65959c80c0b1ebb99b7cc5445d5dfbef536c9d3bc51bc90937b0e8b3a1` |
| `test/footprint.test.ts` | 4238 | `40620b52171bcb7b2445789f6fe066b2bcc658887b38592aa7a57053470bef79` |
| `test/frontmatter.test.ts` | 3204 | `5b20743b544ef7c3be3f77c3d9377f577c31a1f30fadc9462a4ad22760ddadc2` |
| `test/goalContract.test.ts` | 7061 | `40c37c245ab17721c28799aaf59cc2422429510a00c66e6c7563228c13c73cba` |
| `test/identity.test.ts` | 4431 | `7656158eb5b4af30939741bc4a1515095400e10a1da999bb40f2339e821ddaea` |
| `test/install.test.ts` | 35233 | `73b0bf063e96b1b2b959a996671379afab2322512ce707b4d556565c019839d2` |
| `test/installSpace.test.ts` | 2234 | `8d589c1d8e2423869c788c11435e0fc23be6abc5145d7b66c9fb54cc09671c71` |
| `test/investigation.test.ts` | 1551 | `e6a4a95033f27fef486f8709762e650919c3ae429c50af5a3877243cd4e1d2b2` |
| `test/io.test.ts` | 959 | `c483a9c9f9a4ca51e595df125fb36a8a23627a331ac9fbe871f1c404f858fe4a` |
| `test/lsp.test.ts` | 2276 | `e6808cbdb5df0d78dd645b1b5a0e73ce64029eb2aa0e09516e585e523b673a6a` |
| `test/lspConfig.test.ts` | 5170 | `074bd54fd9163aaaa1ccdf9cbe6b647ca0c60e150cccb2553cd42330996f8952` |
| `test/mcp.test.ts` | 2352 | `b4ccdef6695d1b05082cd6ea7a1003f692daf606913e9456be1eca2c61e98fb7` |
| `test/mcpConfig.test.ts` | 2758 | `94cdd10740d1f736a34adeecd443460a038c018ecfb0edea53aeb11f40d6dcf5` |
| `test/memory.test.ts` | 6858 | `9c3f52764efacf803a5a86ba3d69cee383cd015393f62e918f8f7e9e8ab8f296` |
| `test/memoryDialogue.test.ts` | 2579 | `fc4381fc4b296b1c9b527115d3558e3ce56fff4fba4aa12e572c79e088fc8d24` |
| `test/models.test.ts` | 15085 | `140538ace5c885d43a0c498240d08fbe29726ea4983eaf7b34666d6513d48171` |
| `test/modes.test.ts` | 8289 | `be0e7c11f1af1d25e4ea5e457d3b403ac310e45c79f06ddc3baeea697c64d45b` |
| `test/onboarding.test.ts` | 6117 | `9e45cc4cbeaed79e4f5644f28d4faea87ee34152e96972973c93774c9ae344ae` |
| `test/opencodeRuntime.test.ts` | 3366 | `bf0c644e9ffe3e572d49c3e2ccab99cf752e88f27cd4b9cf4596ddbc16434fdd` |
| `test/origin.test.ts` | 4002 | `d75f26822785389c2c9a3b1213c74555ced930c374797d2e702c80fad6788b9f` |
| `test/plugin.test.ts` | 95573 | `1b75ac96664a00adca68c9d86e75b30489e2ae0b09580aad08d6ea27bf466222` |
| `test/repo.test.ts` | 2929 | `259c2d03f3261d3392fb1898f590b9bd6ce6248614a5b6d8d6f319e60b4d01e0` |
| `test/roster.test.ts` | 4444 | `1a37243b871c1d85ceaf91beadffba6347051344860701fe9268841ba3acd57c` |
| `test/runnerIdentity.test.ts` | 4145 | `0a0bbe76c848d5c43bab93165cdc7cfbf5a1d813f75e063e1678ced8792738c9` |
| `test/sanitize.test.ts` | 2020 | `caad202b8910f05c0ad655650b7fca3212242938a7d9122c7c83a6025fa9111d` |
| `test/shellGuard.test.ts` | 2554 | `43433de488ad0d9dccfc07f9a860288b88f02d67737293e8ebab5786282351d1` |
| `test/skillCatalog.test.ts` | 9051 | `ac93c08c7a44cb36cf4d46742c0f0b19362ea873447d52737ec8f840c36460c2` |
| `test/tools.test.ts` | 5560 | `74eee0129d493f99d50af154ebc7ddc12cb897346acaeb9ee5a9e3f982af2c89` |
| `test/turn.test.ts` | 4179 | `e5e4c1f1bf7530393223a4fbe563d1e3bb9e5f0e68283c47146224d57cf1a513` |
| `test/watchdog.test.ts` | 4197 | `cf522fe217f804c45fc55c1b405a1f7d4cda0d4f3134c7a3388202e9a3ae0b53` |

## Footer

এই manifest-টা নিজে hash-এ ধরা নেই। ফুটারের root hash বদলালে
`npm run integrity` চালিয়ে regenerate করুন।
