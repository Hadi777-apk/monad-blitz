const actions: Record<string, string> = {
  openRound: '开启轮次', submit: '提交答案', closeRound: '结算轮次',
  claim: '领取奖励', claimMany: '批量领取奖励',
  mint: '领取测试资产', approve: '授权代币', setApprovalForAll: '授权 NFT',
  createOrder: '创建订单', cancelAuthorization: '取消订单授权',
  fundBuyer: '买家入金', fundSeller: '卖家入金', complete: '完成交付',
  fundingTimeoutExit: '入金超时退款', deliveryTimeoutExit: '交付超时退款',
  cancelUnfunded: '取消未入金订单', withdraw: '提取余额',
  recoverNFT: '取回 NFT', recoverNFTWithAuth: '授权取回 NFT',
}

export const actionLabel = (name: string) => actions[name] ?? '合约操作'

const contractErrors: Record<string, string> = {
  RoundStillOpen: '上一轮尚未结算，请先结算再开启新一轮。',
  NoOpenRound: '当前没有进行中的轮次。',
  QuotaExhausted: '100 个有效轮次已全部完成。',
  RoundExpired: '本轮已到期，无法再提交答案。',
  RoundNotEnded: '本轮尚未到期，请稍后结算。',
  BadAnswer: '答案不符合当前轮次要求，请重新算题。',
  DuplicateAnswer: '此答案已提交，请计算新的答案。',
  RoundNotClosed: '本轮尚未结算，暂时无法领取奖励。',
  AlreadyClaimed: '此项奖励已经领取。',
  UnknownContribution: '未找到此贡献记录。',
  BadConfig: '合约参数无效。',
  BadTerms: '订单条款无效，请检查双方地址、价格、资产和截止时间。',
  BadSignature: '签名无效，请核对签名钱包与订单内容。',
  NotParty: '只有订单的买家或卖家可以执行此操作。',
  AuthorizationUnavailable: '此订单授权已使用或已取消。',
  NftAlreadyReserved: '此 NFT 已被其他进行中的订单占用。',
  WrongStage: '当前订单状态不允许此操作。',
  TooLate: '操作时限已过，无法继续此操作。',
  TooEarly: '尚未到达操作时间，请稍后再试。',
  AlreadyFunded: '你已完成本订单入金，无需重复操作。',
  NotFullyFunded: '双方尚未全部入金，暂时无法完成交付。',
  Funded: '订单已入金，无法按未入金订单取消。',
  NotAuthorized: '当前钱包未获授权执行此操作。',
  NothingPending: '当前没有待取回的 NFT。',
  BadReceiver: '接收地址无效，请使用非零地址且不要填写托管合约地址。',
  AuthExpired: '取回授权已过期，请重新签署。',
  NonceUsed: '此授权已使用，不能重复执行。',
  WrongNftOwner: '卖家当前不是此 NFT 的所有者。',
  InexactDeposit: '实际到账金额与订单要求不一致。',
  NoBalance: '当前没有可提取的余额。',
  ERC20InsufficientBalance: '代币余额不足，请检查余额或领取测试币。',
  ERC20InsufficientAllowance: '代币授权额度不足，请先授权托管合约。',
  ERC721InsufficientApproval: 'NFT 尚未授权，请先授权托管合约。',
  ERC721NonexistentToken: '此 NFT 不存在，请检查编号。',
  ERC721IncorrectOwner: 'NFT 所有者不匹配，请核对卖家与 NFT 编号。',
  ERC721InvalidReceiver: '接收地址无法接收此 NFT，请更换地址。',
  ReentrancyGuardReentrantCall: '合约拒绝了重复进入的调用，请稍后重试。',
}

/** Translate provider and contract failures without displaying raw RPC diagnostics. */
export function errorMessage(error: unknown): string {
  const seen = new Set<unknown>()
  const messages: string[] = []
  let current: any = error
  while (current && !seen.has(current)) {
    seen.add(current)
    const name = current.data?.errorName
    if (name && contractErrors[name]) return contractErrors[name]
    if (Number(current.code) === 4001) return '你已取消钱包操作，可随时重试。'
    if (Number(current.code) === -32002) return '钱包已有待处理请求，请打开钱包完成操作。'
    messages.push(String(current.shortMessage ?? current.message ?? current))
    current = current.cause
  }
  const message = messages.join('\n')
  for (const [name, translation] of Object.entries(contractErrors)) {
    if (new RegExp(`\\b${name}\\b`).test(message)) return translation
  }
  if (/user (rejected|denied)|request rejected/i.test(message)) return '你已取消钱包操作，可随时重试。'
  if (/insufficient funds/i.test(message)) return '钱包原生币余额不足，无法支付交易手续费。'
  if (/chain mismatch|chain.*does not match|chain.*not.*configured/i.test(message)) return '钱包网络不匹配，请切换到页面显示的链 ID。'
  if (/network|fetch|http|timeout|timed out|connection/i.test(message)) return '无法连接链上服务，请检查网络和 RPC 服务后重试。'
  if (error instanceof SyntaxError || /JSON|Cannot convert.*BigInt|invalid.*(number|decimal)/i.test(message)) return '数据格式无效，请检查输入的数字、订单或授权 JSON。'
  if (/revert/i.test(message)) return '合约拒绝了本次操作，请检查订单状态、资产授权和操作时限。'
  // Preserve application-authored Chinese validation messages.
  const local = messages.find((m) => /[\u4e00-\u9fff]/.test(m) && !/[\r\n]/.test(m))
  return local ?? '操作失败，请检查钱包、输入内容和链上状态后重试。'
}
