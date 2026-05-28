# API 参考

## 环境变量配置

### OpenAI-compatible Provider

| 变量名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `ZCODE_PROVIDER` | string | 是 | 提供商类型，设置为 `openai-compatible` |
| `ZCODE_OPENAI_PROVIDER` | string | 是 | 提供商名称（如 deepseek, openai） |
| `ZCODE_OPENAI_MODEL` | string | 是 | 模型名称 |
| `ZCODE_OPENAI_BASE_URL` | string | 是 | API 基础 URL |
| `ZCODE_OPENAI_API_KEY` | string | 是 | API 密钥 |
| `ZCODE_OPENAI_HEADERS` | string | 否 | 自定义请求头（JSON 格式） |
| `ZCODE_OPENAI_TIMEOUT` | number | 否 | 请求超时时间（毫秒） |

### JSON 输出格式

执行 `--json` 模式时返回的输出结构：

```json
{
  "provider": "deepseek",
  "model": "deepseek-chat",
  "messageId": "abc-123",
  "text": "响应文本内容",
  "toolCalls": [],
  "finishReason": "stop"
}
```

### 字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `provider` | string | 使用的模型提供商 |
| `model` | string | 使用的模型名称 |
| `messageId` | string | 消息唯一标识 |
| `text` | string | 模型响应内容 |
| `toolCalls` | array | 工具调用列表 |
| `finishReason` | string | 结束原因（stop/tool_call/error） |