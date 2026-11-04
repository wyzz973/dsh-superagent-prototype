/** Feishu outbound channel: posts threaded bot replies and constructs chat deep links. */
import { z } from 'zod'
import type { OutboundMessage } from '../core/index.ts'
import { CliError } from '../infra/commands.ts'
import { checkedImText } from '../infra/text.ts'
import type { SourceContext } from './host.ts'
import type { ChannelLink, ChannelLinks, ChannelSent } from './kind.ts'
import { feishuTriggerId } from './feishu-trigger.ts'

/** Feishu or Lark AppLink that opens a chat; used when the message's own link was not delivered with the event. */
export const feishuChatLink = (brand: 'feishu' | 'lark', chatId: string): string =>
  `https://applink.${brand === 'lark' ? 'larksuite.com' : 'feishu.cn'}/client/chat/open?openChatId=${encodeURIComponent(chatId)}`
/**
 * True when Feishu permanently rejects a reply because the target message was recalled, withdrawn, or not found.
 * Only a Feishu response carrying one of these error codes means the target message is gone; timeouts or crashes do not.
 */
const gone = (error: unknown): boolean => error instanceof CliError && error.code !== undefined && (error.code === 230011
  || /withdrawn/i.test(error.message) || (Math.floor(error.code / 100) === 2300 && /not found/i.test(error.message)))
/** The reply Feishu sent, whose id the bot can recall it by. */
const SentSchema = z.looseObject({ message_id: z.string().regex(/^om_[a-zA-Z0-9_-]+$/) })
/**
 * Replies in the topic of the target message; Feishu keeps at most one reply per idempotency key (the outgoing message's
 * `message.id`). Returns the reply's own id, which `retractFeishu` recalls it by.
 */
export async function sendFeishu(host: Pick<SourceContext, 'commands'>, message: OutboundMessage): Promise<ChannelSent> {
  const messageId = message.channel.address.messageId
  if (!messageId) throw new Error('Missing Feishu reply target')
  const text = checkedImText(message.text)
  const reply = ['im', '+messages-reply', '--message-id', messageId, '--markdown', text, '--reply-in-thread', '--idempotency-key', message.id]
  let result: unknown
  try { result = await host.commands.lark(reply) }
  catch (error) {
    if (gone(error)) return 'gone'
    throw error
  }
  const sent = SentSchema.safeParse(result)
  return sent.success ? { remote: sent.data.message_id } : 'sent'
}
/**
 * Recalls a reply the bot sent, by its own id, as the bot may recall its messages. Feishu refuses once the message is gone
 * or past the time its tenant allows recalling, which reads as `gone`; other failures retry.
 */
export async function retractFeishu(host: Pick<SourceContext, 'commands'>, message: OutboundMessage & { remote: string }): Promise<'retracted' | 'gone'> {
  const id = SentSchema.shape.message_id.parse(message.remote)
  try { await host.commands.lark(['api', 'DELETE', `/open-apis/im/v1/messages/${id}`]) }
  catch (error) {
    if (gone(error) || (error instanceof CliError && error.code !== undefined && Math.floor(error.code / 1000) === 230)) return 'gone'
    throw error
  }
  return 'retracted'
}
/** Fallback chat link on the bot's brand; the message's own deep link on its Trigger is preferred when available. */
export const feishuLink = (address: Record<string, string>, links: ChannelLinks): ChannelLink => ({
  url: feishuChatLink(links.feishu?.brand ?? 'feishu', address.chatId ?? ''), label: { zh: '飞书消息', en: 'Feishu message' },
  ...address.messageId ? { triggerId: feishuTriggerId(address.messageId) } : {},
})
