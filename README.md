# ZCode CLI Agent

一个强大的 CLI 工具，用于与 AI 模型进行交互。

## 📁 项目结构

```
agent壳/
├── docs/              # 文档中心
│   ├── getting-started/  # 入门指南
│   ├── guides/           # 使用指南
│   ├── references/       # 技术参考
│   └── templates/        # 模板资源
├── ZCode/             # 源代码目录
│   ├── src/            # 核心代码
│   ├── test/           # 测试文件
│   └── README.md       # 本地启动说明
└── README.md          # 项目概述
```

## 🚀 快速开始

详细的入门指南请参考：
- [快速开始](docs/getting-started/quick-start.md)
- [本地开发环境配置](docs/guides/local-development.md)

## 📚 文档

| 分类 | 文档 | 说明 |
|------|------|------|
| 入门 | [快速开始](docs/getting-started/quick-start.md) | 快速上手项目 |
| 指南 | [本地开发配置](docs/guides/local-development.md) | 环境配置详解 |
| 参考 | [API 参考](docs/references/api-reference.md) | 环境变量说明 |
| 模板 | [README 模板](docs/templates/github-readme-template.md) | README 编写指南 |

## 📖 使用示例

```bash
cd ZCode
bun run start --help
bun run start -p "Summarize this repository" --json
```

## 📄 许可证

MIT License - 详见 [LICENSE](LICENSE)