# ZombieCoder Integrity Manifest

> **কী:** repo-র source, scripts, tests, skills, `package.json` ও `LICENSE`-এর
> SHA-256 manifest। **কেন:** accidental বা unauthorized change ধরা। **সীমা:**
> এটা legal identity signature নয় — যে repo edit করতে পারে, সে manifest-ও
> regenerate করতে পারে।

```text
╔══════════════════════════════════════════════════════════════════════════╗
║  root  7084ac4458472d4484b135c8ec67462290018619320addc4f8a4635606d571f9  ║
║  files 140 · bytes 1337129 · base e603d96 · dirty                        ║
╚══════════════════════════════════════════════════════════════════════════╝
```

| Field | Value |
|---|---|
| Schema | `zombiecoder-integrity/v1` |
| Generated (UTC) | `2026-11-06T22:54:47.722Z` |
| Base commit | `e603d96` |
| Branch | `main` |
| Code tree | `dirty` |
| Files | 140 |
| Bytes | 1337129 |
| Root SHA-256 | `7084ac4458472d4484b135c8ec67462290018619320addc4f8a4635606d571f9` |

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
| `bin/install.mjs` | 86820 | `b42a74441729fbc572260997683b8783dcdb459732435c605fb277cabe710cc3` |
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
| `install.sh` | 35770 | `e7068e5e91e0a8b60568a7fd0fb4f50364cfeac0422975f24e9f2dcd684d243f` |
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
| `package.json` | 2423 | `f4f20b8075694e69784d1fc28edde566c273d41e2b12cc6c4343aa2c49a41db8` |
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
| `src/agents/base.ts` | 6705 | `6e8c1f9d5d03c2f552d52c2b433eee8292ae9a63c9b91a3002aad7e5074c5f88` |
| `src/agents/brishti.ts` | 1905 | `1a894e846c733aac9c61b3c22b7d5f3254dc3063bdd0b604b2e697763f087de5` |
| `src/agents/defaults.ts` | 3352 | `8697ad5eaa2979812ddaa9c84bb5d8e4b1732c4d4e33044919b62d64f47bca54` |
| `src/agents/halim.ts` | 1935 | `2ddc0f5097e4d703b0e64548f4e6e1f930ec2e0dcfa6b5743ab117421e5ec83f` |
| `src/agents/index.ts` | 4509 | `245c6de43f295d406536b2bfb48f414781f7345d55dd16c55039ed067e538aac` |
| `src/agents/jarin.ts` | 1650 | `ff791ee47845d672a9dc86754d6f046a57e6b919395246015b8ed97241a6f603` |
| `src/agents/majnu.ts` | 1820 | `d3f0aa732c87dadd00cac7866b19e4a08440e5d56e86066e5d0ee79334f3e61a` |
| `src/agents/manu.ts` | 1781 | `04d229ac7298a076a5db7673d8bf0a76cfe5d6cf8931ef9f64f5570a03c8aeca` |
| `src/agents/nila.ts` | 3735 | `81392719224f192753b1ba8e5489a831a5c52299fa75cba1c7599e3b1437397b` |
| `src/agents/rashed.ts` | 1748 | `75fe74123f35f4f3e447ffab619d19b20aa6be3dce4e6931db9645ec3f6e83b3` |
| `src/agents/route.ts` | 10247 | `b9d8c97923658430df1932714bfc6bd72646a1472f581deee37e202eef293be2` |
| `src/agents/runtime.ts` | 7140 | `ea2b19fd5f69ffb78becdfe7e4127114c4f1ff900669408219d902bb7c06e3f2` |
| `src/agents/shared.ts` | 30081 | `d1db108e58d744d4045e9c5884809ff855a81bc5f248803d64908d3d2d5c1f9e` |
| `src/agents/tuhin.ts` | 1964 | `9ff9a03166f09d8909ae2da277e30d62fd0f81e1f6deb68f8f103d811a031f14` |
| `src/agents/types.ts` | 3242 | `2e85269397c5277ac1004810358895cc7820bf32e9b40f06e4d51a02376f5688` |
| `src/agents/zombiecoder.ts` | 2380 | `da0185cb6f028e3c2b112c44c0029597f269dcf31300ab48cb384b48213975ea` |
| `src/ethics.ts` | 12748 | `aa323a52c7713398095d1297ce1eca30b7352cdb19d9092b212586516590cd85` |
| `src/generate.ts` | 6924 | `be7e240994d953a8fb8e3864558f6609389e1780556b7182a58a0e21a7827be6` |
| `src/identity.ts` | 11774 | `c604e580cb428f9ae2650dca6fca9434d774861aaa25d5c1aeb0f0a9245d6ce3` |
| `src/install/space.ts` | 3813 | `098fe34dfe34003f1ad66cb1e6aa32f4ef8415bc9d81f198c61776fbd31f4931` |
| `src/plugin.ts` | 92931 | `ca448c18eea7f36603d3371496a9a9fa0a88453b968c8c9b6bddf3656f15e0c6` |
| `src/roster.ts` | 9639 | `afee7a37b5cdbc607869f89a92520f40744bb7f0989931cf7b681362f943c468` |
| `src/runtime.ts` | 16105 | `e1c0ed06475af247a55da955b1b2af13966e2c5229081d45de4f742ea14ff80e` |
| `src/zombie/circuitBreaker.ts` | 8135 | `ac7f86ed2a0977d59946c490b02b37e06b8d6447a0ea7d39be868dfc35ce320f` |
| `src/zombie/context.ts` | 17347 | `6ba9781a462f502a0d43baf12b843d3b7897b649e863cece2c76cffc575b3572` |
| `src/zombie/defaults.ts` | 3489 | `d9219f68b9af5c7d52bb485b892353431be32c105dc55a27a31e26e118a9ffa1` |
| `src/zombie/design.ts` | 13664 | `d47465bf40d7fbe879e6aaa11fc70174406cf6bd85375b5390e2a089af756601` |
| `src/zombie/docsConsistency.ts` | 3826 | `996e71595316da95ffa2db2ba3169d5b47c6655ed214cbaf76215b4980760516` |
| `src/zombie/focus.ts` | 13450 | `83b95b0216e699fda9047cad4ce854de8fd9c22182d174fa800f0f6ff411b14b` |
| `src/zombie/frontmatter.ts` | 10771 | `97a5c91c10c8edf838b7e6d47ad2549874885c0316254c3457434ceff0f07b16` |
| `src/zombie/goalContract.ts` | 13607 | `e713487a6419eeaad0f4c0d5b271b5b4f96072d7c73e1912b4e71e22cc8f73d1` |
| `src/zombie/io.ts` | 5006 | `89b3f44e558f7b7d07735a9ac0a1fc3f610794c2ac10f50d3e7cd19b379d5dad` |
| `src/zombie/lsp.ts` | 13112 | `4ad4e476d20812de3f93bb8182d535cd3e1ed2764a8e117083daa9511cb25604` |
| `src/zombie/lspConfig.ts` | 7794 | `afcb29b0335f0d693780057eedb9db4f37310b4dddde1b083d5b972f0bf7f66b` |
| `src/zombie/mcp.ts` | 5564 | `2222d1adb6307c9767ac7392457acd25cf991c9130559825cc5ab383d6503b8a` |
| `src/zombie/mcpConfig.ts` | 3171 | `75b82836105f6d2fe16a42d90c2de5c72efd7043b5e5f127243f6769e15baaf8` |
| `src/zombie/memory.ts` | 13665 | `6b2a6a52ad2965b37bfcc605872baef24f2701619835d96a3c6677dd1b3c7973` |
| `src/zombie/models.ts` | 18746 | `e63f8dbfb085c7eb1f89af41db7c6ed0e2a51df730348cfabd055a9c907004e8` |
| `src/zombie/modes.ts` | 11206 | `3b257382796415773efae4b7fd372c2ef11e25e3523d5403b12f21d867a75eab` |
| `src/zombie/onboarding.ts` | 13844 | `7ee49c13c790326ae8d148e5a5ece209fa0a1c145ddd544b5e69a085ae7e1591` |
| `src/zombie/opencodeRuntime.ts` | 3884 | `1a4e01058f31e2cbfea9a1bfa456944fec8e70c9f338249b2033cf0d19cd14d9` |
| `src/zombie/origin.ts` | 5116 | `6b37139ebcf59a436a05e3fb3eb28be4ad4aa195a099fe388faab9030d73567c` |
| `src/zombie/paths.ts` | 4069 | `5c112f868245e5ea52f8db0b4f397579d05fda008b0f30fa750267846d3de77c` |
| `src/zombie/responseGate.ts` | 39063 | `d2d5d725428a49dd9c9f8a20230e817676089f4627f7af2182e1ae27c2ee279f` |
| `src/zombie/runnerIdentity.ts` | 7631 | `7926e5533c287e0f757acd15623d4f0825a6eefa488379243059fd1f8ad659bc` |
| `src/zombie/sanitize.ts` | 2173 | `d8fe339c61516c679ed35bbfe234375f977b7aff5673e375b4862ce8a15dc7ac` |
| `src/zombie/scan.ts` | 8082 | `3c5e756fede3cbf06fccdacb1f4606efd15f3b86a624c42a570b25473dbff081` |
| `src/zombie/server.ts` | 78251 | `01abc4149b19c9e41c556e55ca2db6bab7a59fc91004a2dabb10b4a31561fa35` |
| `src/zombie/shellGuard.ts` | 7546 | `5c77f8a4cb8395c8795dd80411b1553a884fda5c4c3f2c7de0738ce7b4a2687c` |
| `src/zombie/skillCatalog.ts` | 23840 | `abb0ad8dbfa0ded08f3c2631da78deb2065ddc005c9f30acca7f43cb014b0325` |
| `src/zombie/skills.ts` | 5815 | `0140442c49dfbe9ad7d02db80d310e314f5e126d9441dd33c4d6371894cba3d3` |
| `src/zombie/ssot.ts` | 6978 | `8a6086ac0c5a410895c5370485d71d799906e1c52cca6f9e46ca33865f67ea6f` |
| `src/zombie/syllabus.ts` | 11658 | `749d703456fe7f837802b458baf79f9a53e0843484494ee1f4fce22377491757` |
| `src/zombie/transform.ts` | 3964 | `1c25f3eb1f6ecc9c8ed68b9894f2dfcffb75e233540be06b81f8bda78cc11ba2` |
| `test/agents.test.ts` | 9334 | `5af6ca2cdf384f32282897a01a01de242436140727dd8c0d4e872b1aefc3d001` |
| `test/audit-install.test.ts` | 4155 | `78ac9b2a258dba24cc55474ec8d03baf2ef4c66d1797e272717c0b369cfd8d44` |
| `test/circuitBreaker.test.ts` | 4791 | `83dff617538d24745fb23cb9fad77dc9dac9254361c6b579a9f7f1baafe9471e` |
| `test/context.test.ts` | 34954 | `56e84667a5876960a56540733f02ba800da390fe78e44a9e24cd9fa44c6327df` |
| `test/design.test.ts` | 4746 | `a1995cf09d563b94713a23f73d9c5ff3330f45c96125dc7cc908b361736f0c2e` |
| `test/docs.test.ts` | 2157 | `d2b97395a5ab3b7710350d778e2b76857d740caf978842da5126efdc09fd94e2` |
| `test/focus.test.ts` | 4051 | `47d93d65959c80c0b1ebb99b7cc5445d5dfbef536c9d3bc51bc90937b0e8b3a1` |
| `test/footprint.test.ts` | 4238 | `40620b52171bcb7b2445789f6fe066b2bcc658887b38592aa7a57053470bef79` |
| `test/frontmatter.test.ts` | 3204 | `5b20743b544ef7c3be3f77c3d9377f577c31a1f30fadc9462a4ad22760ddadc2` |
| `test/goalContract.test.ts` | 7061 | `40c37c245ab17721c28799aaf59cc2422429510a00c66e6c7563228c13c73cba` |
| `test/identity.test.ts` | 3944 | `ee835ab860ef3efd03cc9f2eefdba10fdeeda791e2f18b1453fa6f1e75fc03fe` |
| `test/install.test.ts` | 33315 | `f969c057f74cef5cdb22eba33033600ec88e481a6ba629120047cf1fcb557a25` |
| `test/installSpace.test.ts` | 2234 | `8d589c1d8e2423869c788c11435e0fc23be6abc5145d7b66c9fb54cc09671c71` |
| `test/io.test.ts` | 959 | `c483a9c9f9a4ca51e595df125fb36a8a23627a331ac9fbe871f1c404f858fe4a` |
| `test/lsp.test.ts` | 2276 | `e6808cbdb5df0d78dd645b1b5a0e73ce64029eb2aa0e09516e585e523b673a6a` |
| `test/lspConfig.test.ts` | 5170 | `074bd54fd9163aaaa1ccdf9cbe6b647ca0c60e150cccb2553cd42330996f8952` |
| `test/mcp.test.ts` | 2352 | `b4ccdef6695d1b05082cd6ea7a1003f692daf606913e9456be1eca2c61e98fb7` |
| `test/mcpConfig.test.ts` | 2758 | `94cdd10740d1f736a34adeecd443460a038c018ecfb0edea53aeb11f40d6dcf5` |
| `test/memory.test.ts` | 6858 | `9c3f52764efacf803a5a86ba3d69cee383cd015393f62e918f8f7e9e8ab8f296` |
| `test/memoryDialogue.test.ts` | 2579 | `fc4381fc4b296b1c9b527115d3558e3ce56fff4fba4aa12e572c79e088fc8d24` |
| `test/models.test.ts` | 14604 | `53563913d22a1fe16149511df4a95e4f0ec3e2e78c4f2992fa33507e98ab2950` |
| `test/modes.test.ts` | 8130 | `54fef5f2aa36b019bb8229a485038e9636e60a129bdfe8c284ead78b306956e8` |
| `test/onboarding.test.ts` | 6117 | `9e45cc4cbeaed79e4f5644f28d4faea87ee34152e96972973c93774c9ae344ae` |
| `test/opencodeRuntime.test.ts` | 3366 | `bf0c644e9ffe3e572d49c3e2ccab99cf752e88f27cd4b9cf4596ddbc16434fdd` |
| `test/origin.test.ts` | 4002 | `d75f26822785389c2c9a3b1213c74555ced930c374797d2e702c80fad6788b9f` |
| `test/plugin.test.ts` | 85189 | `13d637282eb60cfdafc8e9f1549336112cc55b33c3e8fbe9047dff19ec329c25` |
| `test/repo.test.ts` | 2891 | `dfe11cfde7963d84f580a12d49c6acbf81494a9087e4dbe1c04ebca4e9c0427e` |
| `test/roster.test.ts` | 3871 | `cabdf3d2958b3e5e66cfa175a059874a79578eac471c31c3d54eea3def6068c4` |
| `test/runnerIdentity.test.ts` | 4145 | `0a0bbe76c848d5c43bab93165cdc7cfbf5a1d813f75e063e1678ced8792738c9` |
| `test/sanitize.test.ts` | 1479 | `3007467c56d4af5e853e60ec08cddbeaf4f7f9281822cf8f1199e1618d7ae870` |
| `test/shellGuard.test.ts` | 2554 | `43433de488ad0d9dccfc07f9a860288b88f02d67737293e8ebab5786282351d1` |
| `test/skillCatalog.test.ts` | 9051 | `ac93c08c7a44cb36cf4d46742c0f0b19362ea873447d52737ec8f840c36460c2` |
| `test/tools.test.ts` | 5560 | `74eee0129d493f99d50af154ebc7ddc12cb897346acaeb9ee5a9e3f982af2c89` |

## Footer

এই manifest-টা নিজে hash-এ ধরা নেই। ফুটারের root hash বদলালে
`npm run integrity` চালিয়ে regenerate করুন।
