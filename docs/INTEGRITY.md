# ZombieCoder Integrity Manifest

> **কী:** repo-র source, scripts, tests, skills, `package.json` ও `LICENSE`-এর
> SHA-256 manifest। **কেন:** accidental বা unauthorized change ধরা। **সীমা:**
> এটা legal identity signature নয় — যে repo edit করতে পারে, সে manifest-ও
> regenerate করতে পারে।

```text
╔══════════════════════════════════════════════════════════════════════════╗
║  root  6201ab344ed6b1c0b461aa0f00f67167c02f6df93f7f55bbb0249e6dd71c7a50  ║
║  files 189 · bytes 1788297 · base a0eb6f4 · dirty                        ║
╚══════════════════════════════════════════════════════════════════════════╝
```

| Field | Value |
|---|---|
| Schema | `zombiecoder-integrity/v1` |
| Generated (UTC) | `2026-11-22T19:18:03.758Z` |
| Base commit | `a0eb6f4` |
| Branch | `main` |
| Code tree | `dirty` |
| Files | 189 |
| Bytes | 1788297 |
| Root SHA-256 | `6201ab344ed6b1c0b461aa0f00f67167c02f6df93f7f55bbb0249e6dd71c7a50` |

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
| `bin/install.mjs` | 98424 | `8d998c7867cae1e8827213fdab485f6f7e8e46fe07ff84ac9a7361c164f4aad0` |
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
| `docs/skills/root-cause.md` | 2233 | `e7d7c17627003302afa2e8ad48416d93cb4181572f451703b44dae518e34f811` |
| `docs/skills/scrape-verify.md` | 3098 | `2234c0e92c4ee379cf1268d6f2f62fbf12a1443f73f30f0d36a9f1b41671ef8d` |
| `docs/skills/server.md` | 1685 | `0149a648a6e8b4d8104097986e6796ceb224433707f5e73c281de5e7577eb4e3` |
| `docs/skills/tailwind.md` | 595 | `d89971988125a3d5cc457034e172ca54d758d03c277e9a8b57554b7d06e38e1b` |
| `docs/skills/test-planning.md` | 2494 | `0f5f716de429fdfb778a3e8ce8a170a2201bdbd1fbb4b8d2b2e803d2936f24cf` |
| `docs/skills/threat-model.md` | 2375 | `8797750b7ae0dcece533a490321a848485f858f6f34d2028006b2b5ca0ce6ed1` |
| `docs/skills/typescript.md` | 638 | `07d314e2ab542bbfe39b5fdcfd1e4f8ebc255b61ca989c3f9970608e1095cc5e` |
| `docs/skills/uiux-delivery.md` | 3952 | `c2a66f4f4f3edbee5135b6e4b05ef82165f35baf1f9a7138c0d0f0d268394e15` |
| `docs/skills/web-delivery.md` | 4247 | `61ce13fc7897d4cb1a7bd59cfaa058ef6d94d6d7e7cb34295b179bc7e72cf0db` |
| `install.sh` | 38130 | `c3785f31e1a7da6866ceadfa828afd165114cbcb2f2f7d6ff17e445d3daef002` |
| `LICENSE` | 1961 | `d06b8b22307bf25fa4e3dba778ad2ccc1350c2e5cd1b5e6ed40c2de25b6cd95a` |
| `mcp/cdp/e2e-live.mjs` | 6342 | `5bba9df285ffec88c07da877df772b4c7f08aeedee21adf7845e1b7d4b961a53` |
| `mcp/cdp/README.md` | 4509 | `9be4ea29ff1173489eeebf66746ce5113070b11f6c17050c6ac4bd85c9e3e559` |
| `mcp/cdp/selfcheck.mjs` | 2568 | `1379edf5498878c5d38aa39ab2d49593a3f1a8a265c3bb35e68826e9ab208c21` |
| `mcp/cdp/server.mjs` | 44133 | `1cd7d6b76b37432b349ec08f5c7b9ad409292c36a8b459b9c008f3201168b6e6` |
| `mcp/cdp/test/cdp.test.mjs` | 5175 | `939966e51585d6ed91f3ef0b97e97e93d530a20c1a1ae9027d38efc775078a26` |
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
| `package.json` | 2837 | `753c5deb4269632c41dce182a12f9665d0d930ad47fa9ce8e782a9e8dda5de4c` |
| `scripts/agent-model-sync-probe.mjs` | 8715 | `9c4035817fe57f01543fb348a334a6e161f31a9acecdfed4d8ab366e5c738607` |
| `scripts/agents-check.mjs` | 6808 | `b7f71c2350aaf9a9b42652907ee204fe673baac6b0164473cba87f70cd50ef3f` |
| `scripts/allow-always-check.mjs` | 3138 | `514642a97a4f3a3a3f67b68789d8b2e1665680d2623e79d14ba640c6d395c257` |
| `scripts/audit-install.mjs` | 9325 | `74ab674aa38fac5104a0ba89de7127f33ca12817d225602fe3df363ec61fa5d5` |
| `scripts/check-clone-install.mjs` | 8713 | `cd98c915d0e262299fd8fd903a9c8a16539b4184fe93ac8306a1f9569c453184` |
| `scripts/check-install-assets.mjs` | 6538 | `2ebbd9ec3122f9ca50ef1501bb8c878b686ed970445ef02f46aadff2d0f445f0` |
| `scripts/check-release.mjs` | 6497 | `829e7d40e1511124e87e108a430d83bab5dd3682aaab0dcac772d055eed7733b` |
| `scripts/check-skill-library-yaml.mjs` | 9231 | `1a0b4e9381e353e1cca6e2d29fe088712514cd79c6f8b4202d6558082fa8796d` |
| `scripts/configure.mjs` | 14570 | `53c62929b01c0cc5bddc1a21935e88790c6f67a8d5b7989711b894a6da0faf18` |
| `scripts/docs-check.mjs` | 779 | `391e4b5f418b6357a67bba6019b2c2818fb3e86889a4eaba0722dc49802917e7` |
| `scripts/e2e-install.mjs` | 14358 | `a6aded4609362a02aa239f8a632d6c02c1fdd61decad1fe7c2054ff7eea3761b` |
| `scripts/e2e-modules.mjs` | 11543 | `1694ac11608f0d270a9d4f9b4495477a6faca49a75394f9ea5d639845eeba8a8` |
| `scripts/finalize-probe.mjs` | 4698 | `ed5db5c8fcad94430a996a2897087e78bd03c19613784fc61e8480e656d8f9a8` |
| `scripts/five-steps-probe.mjs` | 7003 | `f212a94be2e512963b5a5721797880c006089327efe6f8c02b7d26b5d70362da` |
| `scripts/identity.mjs` | 4840 | `6cd9ec01f95af6a376745b4db047abd8ae77e5867fd5d6a91a99c82f1033f32d` |
| `scripts/integrity.mjs` | 10412 | `a3a5b5088aa601a1753b1032e21d390ada5b9b32ed4a54de8900357c488a9515` |
| `scripts/lsp-diagnostics.mjs` | 8920 | `9ee3431929bf4fec4e39d822e0a1876380229fda3408b7fa8c2f326a51ab4121` |
| `scripts/lsp-probe.mjs` | 7294 | `77f7d44d6529d2d73376c4ca09053c046d3209af0b90ec1da5fda2335c4fe7ae` |
| `scripts/merge-probe.mjs` | 4829 | `434ee159ce6937301fe3f22918b238c8e991c570c26a6e6157b5736c73d9a1dd` |
| `scripts/modes-check.mjs` | 4341 | `0135f1f8fd3ef2c076c4be85f0b7ece12e36f5478c0ba88a34db7e40306557c5` |
| `scripts/setup.mjs` | 12763 | `57420239b7df1f9401c70fba2bc3377a3b0b8f1ef49e2d6a1a8f1786b0ea45c4` |
| `scripts/symbol-probe.mjs` | 3452 | `f9377dbe1d9f199a6d0a139ee46dc2ef4708fadc2dc1441ae5475c550dddc8fe` |
| `scripts/verify-agent-route.mjs` | 8008 | `64647a5b434d85fc8d0bc5d31dd610a2a3df0f5a75624aead0265b27dd5f5a84` |
| `scripts/verify-wiring.mjs` | 31236 | `88fadbe0b58bd2307b1f2b9d2f6d098beda777283b37613d33728f1159da56b0` |
| `src/agents.ts` | 13479 | `0e9fc2b22e375579fb2e77d8772717aec58cf31bd0bad91795cbd0dd4b46574e` |
| `src/agents/base.ts` | 8510 | `94e4a7f2b777bab0362276d3b756ab3772d464538eb8484dae1f472558072ea8` |
| `src/agents/brishti.ts` | 1905 | `1a894e846c733aac9c61b3c22b7d5f3254dc3063bdd0b604b2e697763f087de5` |
| `src/agents/defaults.ts` | 7277 | `a859b9894e492556bd89fa50513486720056ac21e371b82404ab0bad8d4ab812` |
| `src/agents/halim.ts` | 1935 | `2ddc0f5097e4d703b0e64548f4e6e1f930ec2e0dcfa6b5743ab117421e5ec83f` |
| `src/agents/index.ts` | 4509 | `245c6de43f295d406536b2bfb48f414781f7345d55dd16c55039ed067e538aac` |
| `src/agents/jarin.ts` | 1650 | `ff791ee47845d672a9dc86754d6f046a57e6b919395246015b8ed97241a6f603` |
| `src/agents/majnu.ts` | 1820 | `d3f0aa732c87dadd00cac7866b19e4a08440e5d56e86066e5d0ee79334f3e61a` |
| `src/agents/manu.ts` | 1781 | `04d229ac7298a076a5db7673d8bf0a76cfe5d6cf8931ef9f64f5570a03c8aeca` |
| `src/agents/nila.ts` | 2034 | `a93a830cfe43253033106aecab81a3106b0c84daf2c0e2b1d7c959c6450a717b` |
| `src/agents/rashed.ts` | 1748 | `75fe74123f35f4f3e447ffab619d19b20aa6be3dce4e6931db9645ec3f6e83b3` |
| `src/agents/route.ts` | 12448 | `608d4b6ea90d3aa8dccc74c3ebfe9cd66830d1f3563759a8de43fecfb4fe41ad` |
| `src/agents/runtime.ts` | 10195 | `3c87ac5f7618c6ea66a92e9c287b23d3bc7e4191f5377746db22f01b04913670` |
| `src/agents/shared.ts` | 8036 | `e315c40c0641c56981d5838542f5c5b9ee97e4afb791fa60823908a02da855d7` |
| `src/agents/tuhin.ts` | 1964 | `9ff9a03166f09d8909ae2da277e30d62fd0f81e1f6deb68f8f103d811a031f14` |
| `src/agents/turn.ts` | 2848 | `36ef7e546f9c8131ab2780af0b8c29ace3082b676b13bd885ef7e9b11bcab0ac` |
| `src/agents/types.ts` | 3527 | `43adfca835048453d4d99a5532e1f3c251dd9b1585913f110a5b3e92dd81add0` |
| `src/agents/zombiecoder.ts` | 2380 | `da0185cb6f028e3c2b112c44c0029597f269dcf31300ab48cb384b48213975ea` |
| `src/ethics.ts` | 12749 | `ff044cef999a1cc0c8eb0deb06d6bfaffd06de5504bc1f3837753db38a78db67` |
| `src/generate.ts` | 6956 | `a908cccdca29b6cad134f07873e83bf86ce9b45d107a4d21a27708c581ed9a3c` |
| `src/identity.ts` | 11767 | `e0a07f913823045857b811ed7cf87e9bc34172cd0fb0662ce75a92691cc49ffd` |
| `src/install/space.ts` | 3813 | `098fe34dfe34003f1ad66cb1e6aa32f4ef8415bc9d81f198c61776fbd31f4931` |
| `src/plugin.ts` | 111099 | `a8c147e8afea304a4677ec69bf3c8667ca746782d39e04ce28cb3a07ecd053fb` |
| `src/roster.ts` | 10457 | `215b78aa854381b12cfb72e0a275f3627808d40da7455ad064a1efaa92b0d8fa` |
| `src/runtime.ts` | 16246 | `948b7c19df008d0961526d10d3f56c3c5a4739b9756e9487aa2fa0768fa41314` |
| `src/zombie/circuitBreaker.ts` | 8526 | `a786855b8c6146dacc4d366976516883456d1c2644094cc773c70c4c63a0dba7` |
| `src/zombie/context.ts` | 23491 | `babab8263d12738ab633e30930ba77572f4414483990593a0f1e7eaf02a14cbf` |
| `src/zombie/defaults.ts` | 3737 | `8343aa089d2fd9b8d4995f600f413dd5e4f650e4351c966583ae26e3552b7ec6` |
| `src/zombie/design.ts` | 13478 | `7374301b4ebc6d5754456c7396cc85ee7cda6c599aa8c2d8a3c4e4cc7a83d3d0` |
| `src/zombie/docsConsistency.ts` | 4401 | `c691b4f92f04e6f37606c0ef18823461bcd8fc6f489aeb52047bc4476a60fd27` |
| `src/zombie/focus.ts` | 13450 | `83b95b0216e699fda9047cad4ce854de8fd9c22182d174fa800f0f6ff411b14b` |
| `src/zombie/frontmatter.ts` | 10771 | `97a5c91c10c8edf838b7e6d47ad2549874885c0316254c3457434ceff0f07b16` |
| `src/zombie/goalContract.ts` | 13607 | `e713487a6419eeaad0f4c0d5b271b5b4f96072d7c73e1912b4e71e22cc8f73d1` |
| `src/zombie/intent.ts` | 1358 | `a84a333928237442d0b6b7e558cf59bfb953f8d3d1e2f0247ce58a876f50da2e` |
| `src/zombie/intentRules.ts` | 2883 | `ee1d86c65bd18fd68392dc97b1a19f2f0bb572e4a3815d4f24a857513ca4117f` |
| `src/zombie/investigation.ts` | 8389 | `3c623a27de50d78ec47fbeba309c3cd21387e344c68b0fed63a5bf6eb52353e4` |
| `src/zombie/investigationPackage.ts` | 5179 | `4453bdb4e1388c4d743670dd9d5765c9b3a896eff8f3e4eb86987a4b998a7eab` |
| `src/zombie/io.ts` | 5501 | `ea1e2e86293380c1af37d143ed53fa231d824022a42d95c0c8aebf5542c255fd` |
| `src/zombie/lsp.ts` | 13112 | `4ad4e476d20812de3f93bb8182d535cd3e1ed2764a8e117083daa9511cb25604` |
| `src/zombie/lspConfig.ts` | 7794 | `afcb29b0335f0d693780057eedb9db4f37310b4dddde1b083d5b972f0bf7f66b` |
| `src/zombie/mcp.ts` | 5564 | `2222d1adb6307c9767ac7392457acd25cf991c9130559825cc5ab383d6503b8a` |
| `src/zombie/mcpConfig.ts` | 3171 | `75b82836105f6d2fe16a42d90c2de5c72efd7043b5e5f127243f6769e15baaf8` |
| `src/zombie/memory.ts` | 13665 | `6b2a6a52ad2965b37bfcc605872baef24f2701619835d96a3c6677dd1b3c7973` |
| `src/zombie/models.ts` | 20207 | `de005405f14d06f9cf8f05f6bb518f8b94ab845770168519f8e35bdec6aa1163` |
| `src/zombie/modes.ts` | 9978 | `19bbe3817246bc555dd8cc2b3a61ca2dc60027a3dd92f356f6b8f821f053708d` |
| `src/zombie/onboarding.ts` | 13844 | `7ee49c13c790326ae8d148e5a5ece209fa0a1c145ddd544b5e69a085ae7e1591` |
| `src/zombie/opencodeRuntime.ts` | 3884 | `1a4e01058f31e2cbfea9a1bfa456944fec8e70c9f338249b2033cf0d19cd14d9` |
| `src/zombie/origin.ts` | 5116 | `6b37139ebcf59a436a05e3fb3eb28be4ad4aa195a099fe388faab9030d73567c` |
| `src/zombie/paths.ts` | 4422 | `8ccc6064f994237523070fba137e14f7f579e791002b76fe1c82d25b90e03710` |
| `src/zombie/projectProfile.ts` | 4478 | `ac96ad9939aa05bb736f03e508ed2bb7c7ac5d068064261ffc17f94abe838a3b` |
| `src/zombie/promptBudget.ts` | 2130 | `6e0eeb5d7a64190d46c1b351ab665d818e8c85f526512ae7c7739ff855afb1dd` |
| `src/zombie/protectedRoots.ts` | 4182 | `e3e163e80f06d8df30955c813f9d4241be3ddcd32a30a6efdcfbbf469de84e93` |
| `src/zombie/responseGate.ts` | 39063 | `d2d5d725428a49dd9c9f8a20230e817676089f4627f7af2182e1ae27c2ee279f` |
| `src/zombie/runnerIdentity.ts` | 7631 | `7926e5533c287e0f757acd15623d4f0825a6eefa488379243059fd1f8ad659bc` |
| `src/zombie/sanitize.ts` | 3325 | `c65236840a4e8b9f460149d3209f995171aa3535840e8882239ca2496d5a9ac5` |
| `src/zombie/scan.ts` | 8082 | `3c5e756fede3cbf06fccdacb1f4606efd15f3b86a624c42a570b25473dbff081` |
| `src/zombie/server.ts` | 97096 | `c7abf6c66d33b06c65eabe248f2965cf1de41a997811d97214735475e80367b4` |
| `src/zombie/shellGuard.ts` | 7546 | `5c77f8a4cb8395c8795dd80411b1553a884fda5c4c3f2c7de0738ce7b4a2687c` |
| `src/zombie/skillCard.ts` | 9793 | `ed52a02535c3daf5023cdebc1c46ea1572ae3907643375b3337f8eb5fe22b44b` |
| `src/zombie/skillCatalog.ts` | 24872 | `224cd05412f6e729da834b3573e965406faef549b5f77bc07a6827b68339c8c6` |
| `src/zombie/skillLibrary.ts` | 24447 | `b82a0c74f5e6c3755bd9832d425678d8371ab959ff847b9f1737e73376e627d1` |
| `src/zombie/skills.ts` | 5815 | `0140442c49dfbe9ad7d02db80d310e314f5e126d9441dd33c4d6371894cba3d3` |
| `src/zombie/ssot.ts` | 8026 | `f75f84fcff719115775c985fed8adacf6e4cb6f5f1c3c9e46e95de10bf60b857` |
| `src/zombie/subagentEnvelope.ts` | 5002 | `fe9878734b8d461b82b08acb632be89042f9c5ac8f5c626979b08e66af13b3e9` |
| `src/zombie/syllabus.ts` | 12253 | `d4ceb296e035cab13ff7e176e71c2ba7da77452189990cc36a7bf640d58dc527` |
| `src/zombie/symbols.ts` | 29260 | `33aa0a43c11a6d7466a51c5c20f558d18fcdaecc0b5b211f83730451b0278099` |
| `src/zombie/taskClass.ts` | 4433 | `c7521c601213c06c9a335a8478bc363c96491e8b930f60e92c9fb32fc022d31a` |
| `src/zombie/toolArchive.ts` | 4272 | `97290256da7b3c85befa3501341044d4ca2c1a82913067699fb3465aed43ea65` |
| `src/zombie/transform.ts` | 3964 | `1c25f3eb1f6ecc9c8ed68b9894f2dfcffb75e233540be06b81f8bda78cc11ba2` |
| `src/zombie/watchdog.ts` | 8617 | `4eb7c12c28bc6080ef224f2cc4acbc71fbf42812a46bfd69a73b65f6eedb8a57` |
| `test/agents.test.ts` | 17756 | `69e8cbb307fe4cb64719f6982c9a79b21c4545366bc259431067139dcb061607` |
| `test/audit-install.test.ts` | 6800 | `50bbd3344f1913526ade85cbcf7d6c84a4990d4829c0cf39631017dd3e1305ad` |
| `test/capabilities.test.ts` | 3664 | `ec17caab25ef940f0c786b01250061a8e0ac80ed3cd893c0686ddc3103e8c474` |
| `test/cdp.test.ts` | 3801 | `6e205e15f7e84d5aa65c2ba9e52e7239a9a893a58c59744af960fe36317a2843` |
| `test/circuitBreaker.test.ts` | 5040 | `075d02b09d49f19206b242d8373dfac79413d90ac6211043b99b06814d5b1acb` |
| `test/context.test.ts` | 38346 | `f1507099dec6bbd9449ad7785bb210926c0ab8280696402fefe3ab8a3d5b110c` |
| `test/design.test.ts` | 4799 | `ce13246055690ddf813e9cc07cd6f108731b4cdd9d762f92941ea88d1b306e23` |
| `test/docs.test.ts` | 3227 | `d3d6f18053c2561701291a4b03e38cc00d96b31fcecfdec5fdc0c0a58cd5f85a` |
| `test/focus.test.ts` | 4051 | `47d93d65959c80c0b1ebb99b7cc5445d5dfbef536c9d3bc51bc90937b0e8b3a1` |
| `test/footprint.test.ts` | 4927 | `a008782083058e2bd1bddcf133c31befdfebe1de73bef037c19ac0636580b73e` |
| `test/frontmatter.test.ts` | 3204 | `5b20743b544ef7c3be3f77c3d9377f577c31a1f30fadc9462a4ad22760ddadc2` |
| `test/goalContract.test.ts` | 7061 | `40c37c245ab17721c28799aaf59cc2422429510a00c66e6c7563228c13c73cba` |
| `test/identity.test.ts` | 4431 | `7656158eb5b4af30939741bc4a1515095400e10a1da999bb40f2339e821ddaea` |
| `test/install.test.ts` | 44066 | `b99dcdff1257343038571b63a79a74e19413137386abe5171d77574c0735cd49` |
| `test/installSpace.test.ts` | 2234 | `8d589c1d8e2423869c788c11435e0fc23be6abc5145d7b66c9fb54cc09671c71` |
| `test/investigation.test.ts` | 2983 | `5c21563ea63fd1a876e1f215d738b5741a687a7e71378b64d069a1b59bc863ab` |
| `test/io.test.ts` | 1737 | `5e07043c9e0b58d59687415b96a80b786f05fa574a080948fefa1ee407b4c801` |
| `test/lsp.test.ts` | 2276 | `e6808cbdb5df0d78dd645b1b5a0e73ce64029eb2aa0e09516e585e523b673a6a` |
| `test/lspConfig.test.ts` | 5170 | `074bd54fd9163aaaa1ccdf9cbe6b647ca0c60e150cccb2553cd42330996f8952` |
| `test/mcp.test.ts` | 2352 | `b4ccdef6695d1b05082cd6ea7a1003f692daf606913e9456be1eca2c61e98fb7` |
| `test/mcpConfig.test.ts` | 2758 | `94cdd10740d1f736a34adeecd443460a038c018ecfb0edea53aeb11f40d6dcf5` |
| `test/memory.test.ts` | 6858 | `9c3f52764efacf803a5a86ba3d69cee383cd015393f62e918f8f7e9e8ab8f296` |
| `test/memoryDialogue.test.ts` | 2579 | `fc4381fc4b296b1c9b527115d3558e3ce56fff4fba4aa12e572c79e088fc8d24` |
| `test/models.test.ts` | 16321 | `0fa1e9bac299a1fb20b2bb26063a16e14d6cc619c84e3b0e1510ab1611bfddae` |
| `test/modes.test.ts` | 7938 | `6d260b80a12f778e5b8e68a1a4c36ccfffd663968db20a1076d3b180088ae7fc` |
| `test/onboarding.test.ts` | 6117 | `9e45cc4cbeaed79e4f5644f28d4faea87ee34152e96972973c93774c9ae344ae` |
| `test/opencodeRuntime.test.ts` | 3366 | `bf0c644e9ffe3e572d49c3e2ccab99cf752e88f27cd4b9cf4596ddbc16434fdd` |
| `test/origin.test.ts` | 4002 | `d75f26822785389c2c9a3b1213c74555ced930c374797d2e702c80fad6788b9f` |
| `test/plugin.test.ts` | 97928 | `3c8d3a55721bcf922f4c8bbcf4e9b84e363e8290eab15f9f05501b166244099b` |
| `test/promptBudget.test.ts` | 869 | `724625e71446ae15b982843d2f21bf3b79fa3ec14a7a305efb38d6ec67a7db44` |
| `test/protected.test.ts` | 2931 | `cfb688a6c80a5cca80cb817be625684ad258ef5985adbc7a749a6e623070c88b` |
| `test/regressions.test.ts` | 3332 | `ea148ff8c584116dcf5b0e3c39bc34e9517dd2941ff4b2844440254e506e4925` |
| `test/repo.test.ts` | 3828 | `7a8cefac511c72ec80ce4447f94f8cb5c2a2a8c5399de997bbef76d10851d1c6` |
| `test/roster.test.ts` | 4444 | `1a37243b871c1d85ceaf91beadffba6347051344860701fe9268841ba3acd57c` |
| `test/route.test.ts` | 6139 | `8449daf1050cb5c5fff7dd63e5407678fe842a48c1720c5ac55702c0ce2cd360` |
| `test/runnerIdentity.test.ts` | 4131 | `81b07d69e405b506bb10b0ebea40241d0bc6cc1257f97ed888c14170d86e9f86` |
| `test/sanitize.test.ts` | 2020 | `caad202b8910f05c0ad655650b7fca3212242938a7d9122c7c83a6025fa9111d` |
| `test/shellGuard.test.ts` | 2554 | `43433de488ad0d9dccfc07f9a860288b88f02d67737293e8ebab5786282351d1` |
| `test/skillCatalog.test.ts` | 9051 | `ac93c08c7a44cb36cf4d46742c0f0b19362ea873447d52737ec8f840c36460c2` |
| `test/skillLibrary.test.ts` | 10222 | `1873304cee20ebd49aa613d1f47f45ade41f4c8a5c61ed68946868743f5ea6b2` |
| `test/subagentEnvelope.test.ts` | 3310 | `093de776a3e4e20441d56e1480551587bec6359fe0671ab63209bbb7bce13092` |
| `test/symbols.test.ts` | 3929 | `7fc1034d154ef986be98ddb509b3b716500642e9a5608049e1b938d39fc834ac` |
| `test/taskClass.test.ts` | 2864 | `3d2d38ace16aa785344bbad2871793eaa655ca5bcbc5667db2b0fd4bc4232f57` |
| `test/toolArchive.test.ts` | 2218 | `f8c79a781811f6f7f0813168d34c2607a04747f7a737d0cb114c5e65ffe3842c` |
| `test/tools.test.ts` | 5560 | `74eee0129d493f99d50af154ebc7ddc12cb897346acaeb9ee5a9e3f982af2c89` |
| `test/turn.test.ts` | 4179 | `e5e4c1f1bf7530393223a4fbe563d1e3bb9e5f0e68283c47146224d57cf1a513` |
| `test/watchdog.test.ts` | 4197 | `cf522fe217f804c45fc55c1b405a1f7d4cda0d4f3134c7a3388202e9a3ae0b53` |
| `test/wiring.test.ts` | 9749 | `606e09bddeebcd50b0d969ade1f0ce7bd1ad62b57dc8a91970df1f6dd5603576` |

## Footer

এই manifest-টা নিজে hash-এ ধরা নেই। ফুটারের root hash বদলালে
`npm run integrity` চালিয়ে regenerate করুন।
