# Blitz Mine · 千枚矿场

当前网页支持创建活动、多 AI 本机统计、钱包排名及可跳过时间的演示活动；新旧奖池、模拟玩家和统计边界见 [多 AI 用量说明](docs/MULTI_AI_USAGE.md)。

## 最新参赛版本（2026-10-17）

- 在线演示：[千枚矿场](https://monad.hardy777.top/)。当前入口为 Monad 测试网（10143）活动列表和创建表单，支持 WMON 或其他兼容 ERC-20 奖池。此前 5 个活动已从本站归档，链上记录及余额仍保留。
- 主要流程：连接钱包 → 创建或打开活动并报名 → 读取本机 AI 累计 token 用量或导入统计报告 → 上报期提交 → 按占比领取。当前页面上报报告中的累计总量；早期 UBLITZ 版本的增量起点口径不适用于当前页面。
- 首页创建的是演示活动，创建者可用“跳过”提前结束当前阶段；普通 `Distribution` 活动仍使用不可修改的截止时间。演示排行榜自动预置 10 名明确标注的模拟玩家，刷新时用量不变，只参与展示排序和展示占比，不参与链上分币；上方统计、预计奖励及实际交易只读链上数据。
- 本机采集器基于 Tokscale 4.19.1；只输出来源和数字汇总，不上传聊天、提示词或密钥。数据由用户本机提供，可被伪造，不能当作服务商账单或可信工作量证明。
- 技术栈：Solidity、Foundry、React、TypeScript、Vite、viem、Node.js。网页运行：`cd web`、`npm ci`、`npm run dev`；采集器另开终端：`cd collector`、`npm ci --ignore-scripts`、`npm start`。
- 本次上传沿用已通过的前端构建、模拟排名及旧标签页更新测试，已核对当前源码仍与部署验证构建一致。历史合约和本地链验证见相关说明；本次上传未重跑 Forge，不代表审计或完整钱包交互验收。

以下是保留的 v0.5 原始计算挖矿和 NFT 担保交易模块说明；其本地部署状态不能代替上述新活动的状态。

本地新增独立的 **B：Codex 用量自动分币实验**，详见 [使用说明与信任边界](docs/USAGE_EXPERIMENT.md)。它使用独立演示币 UBLITZ，不解锁或迁移原 BLITZ 中的 200 枚，不改变下面 v0.5 主实例范围。

Monad Blitz 项目，包含独立的链上挖矿与担保交易模块。

**v0.5 原始模块：比赛架构基线 + 首版实现。合约与网页已写成，已有 Forge 测试和本地 anvil 端到端验证记录；这些模块的地址配置目前仅包含本地链，未将它们作为当前测试网演示入口。未完成压测或审计。**

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
- 网页使用内容哈希资源和 `version.json` 检测新构建，已实现旧标签页自动切换及失效分块单次恢复；托管方须保证入口和版本文件不缓存。发布验证记录见多 AI 用量说明。
- 事件读取服务未实现；网页直接读链，扫描自己的贡献在演示规模下可用。
