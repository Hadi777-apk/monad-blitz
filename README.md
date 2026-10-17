# Blitz Mine · 千枚矿场

Monad Blitz 项目，包含独立的链上挖矿与担保交易模块。

**当前版本：v0.5 比赛架构基线 + 首版实现。合约与网页已写成，Forge 测试和本地 anvil 端到端通过；尚未部署到 Monad 测试网，未实测 gas、压测或审计，网页未用真实钱包做过浏览器内交互测试。**

## 当前范围

- 三个核心合约：BLITZ、Mining、Escrow。测试支付 ERC-20 和测试 NFT 属于演示资产，不算额外业务模块。
- BLITZ 总量 1000：A 可分配 800；B 的 200 在当前不可升级实例永久锁定，无后台启用、提取或迁移路径。
- A 共 100 个非空有效轮，每轮 8 枚；每个链上接受的正确答案统一 1 分，多余前导零无加分。
- 分配公式为 `floor(budget×end/total)−floor(budget×start/total)`，逐贡献领取，无整场排序。
- 同一时间只开一轮，开轮预留 8 枚；空轮关闭时退回预留且不消耗有效轮名额。
- 同链测试 NFT 交易：买卖双方各交 P，NFT 必须实际托管；成功交付时原子转给买家，并给卖家记入 2P 可领取余额。
- 交易首版零保护期、无人为裁判。入金/交付超时退款必做；NFT 取回与资金提现分开。
- 自动估价、真实皮肤/实物、B 用量接入、外部争议与多签运营是后续方向，不伪装为已完成。

## 队友阅读顺序

| 文档 | 内容 |
| --- | --- |
| [v0.5 比赛架构全文](docs/ARCHITECTURE_v0.5_hackathon.md) | 用户草案整理后的英文基线，已补齐三处最终检查意见 |
| [架构中文导读](docs/ARCHITECTURE.md) | 三项要求、组件和链上/链下边界 |
| [游戏玩法](docs/GAME_DESIGN.md) | 玩家入场、挖矿、轮次、奖励与实验模式范围 |
| [分币规则](docs/TOKENOMICS.md) | 800/200、预算预留、每题 1 分、舍入与永久锁定 |
| [交易协议](docs/TRADE_PROTOCOL.md) | 签名、NFT 托管、时间互斥、退款与授权取回 |
| [安全与验收](docs/SECURITY_MODEL.md) | 权限、状态、资产守恒、停服退出及验收要求 |
| [交付与分工](docs/DELIVERY_PLAN.md) | 比赛执行顺序、必做闭环、演示与未验证事项 |

## 三处最终补充

1. 退款 NFT 只能由原卖家取回或具体授权他人取回，可选有效接收地址；失败不影响资金退款，不能重复领取。
2. 接口表明确创建、入金、完成及两类超时的时间与状态条件。终态不可重开，资金提现与 NFT 取回权仍保留。
3. Mining 与 Escrow 不互相调用、资金隔离；它们正常调用代币/NFT 合约，NFT 接收回调属于外部调用边界。

## 参数与限制

主 RPC 为 `https://testnet-rpc.monad.xyz`，此前核对返回链 ID 10143；备用尚未验证。难度暂定 16 位，演示轮 60 秒、普通轮 300 秒；订单默认入金 10 分钟，交付截止再延后 5 分钟。以上均未完成实际流程和费用测试。

代码开发须遵守本场活动时间规则；正式作品还需要真实演示、截图及具备队长权限的提交账号。

## 官方资源与许可证

- [活动](https://luma.com/2a2bc5hy) · [资料包](https://monad-foundation.notion.site/Monad-Blitz-V3-e294424a90d943aea95bd7b7d3dbf055)
- [Monad 开发入口](https://monad.xyz/developers) · [开发者 GitHub](https://github.com/monad-developers) · [官方文档](https://docs.monad.xyz/)
- [MIT 许可证](LICENSE)

## 实现与运行

目录：`src/`（BLITZ、Mining、Escrow，`mocks/` 为测试支付币与测试 NFT）、`test/`（Forge 测试）、`script/Deploy.s.sol`、`web/`（Vite + React + viem，含 Web Worker 算题）、`scripts/`。

```bash
forge test                      # 47 个测试：分币、轮次、空轮、第 100 轮、签名、时间边界、退款、NFT 取回等
./scripts/e2e-local.sh          # 起本地 anvil → 部署 → 用 viem 跑完整挖矿+交易+超时退款+授权取回
```

部署到 Monad 测试网（私钥只在你自己的终端里使用，不要写入仓库）：

```bash
DIFFICULTY_BITS=16 ROUND_LENGTH=60 forge script script/Deploy.s.sol \
  --rpc-url https://testnet-rpc.monad.xyz --broadcast --private-key $DEPLOYER_KEY
node scripts/export-deployment.mjs 10143   # 写入 web/src/abis.json 与 deployments.json
cd web && npm install && npm run dev       # 本地演示加 ?chain=31337
```

实现要点与文档的对应/取舍：

- BLITZ 由 Mining 在构造函数中创建并全部铸给自己，之后没有增发/销毁/管理员；200 的 B 份额没有任何转出路径。
- 每条贡献恰为一个点，区间 `[start, start+1)`，奖励用 `floor(B×end/T) − floor(B×start/T)`。
- Escrow 首版部署时固定单一支付币和单一 NFT 合约（对应“首版仅限测试资产”）；订单 ID 即 EIP-712 哈希，“已用/已取消”状态分别记录；订单 nonce 只用于区分相同条款。
- 卖家入金时 `transferFrom` 实际取得 NFT 并核对 `ownerOf`；直接 `safeTransfer` 给 Escrow 会被拒绝。
- 退款与 NFT 取回分离；授权取回签名绑定链、合约、版本、订单、NFT、接收人、动作、nonce 与有效期。
- 网页的“入口不缓存”需由托管方对 `index.html` 设置 `Cache-Control: no-cache`；其他资源由 Vite 自带内容哈希。旧标签页自动切换新构建未实现。
- 事件读取服务未实现；网页直接读链，扫描自己的贡献在演示规模下可用。
