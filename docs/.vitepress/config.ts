import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'Crewmate',
  description: 'AI Agent Workflow Orchestration CLI & Multi-Agent Harness',
  base: '/crewmate/',
  themeConfig: {
    logo: 'https://github.com/user-attachments/assets/966e96b3-f626-4b12-b6d3-1cc5519564e4',
    siteTitle: false,
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Reference', link: '/reference/cli' },
      {
        text: 'v0.3.0',
        items: [
          { text: 'Changelog', link: 'https://github.com/errevion/crewmate/releases' },
          { text: 'Contributing', link: 'https://github.com/errevion/crewmate' },
        ],
      },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Introduction',
          items: [
            { text: 'Getting Started', link: '/guide/getting-started' },
            { text: 'Architecture & Agents', link: '/guide/architecture' },
          ],
        },
        {
          text: 'Core Concepts',
          items: [
            { text: 'Managing Briefs', link: '/guide/briefs' },
            { text: 'Workflow Engine & DAG', link: '/guide/workflows' },
            { text: 'Task Management', link: '/guide/tasks' },
            { text: 'File Locking & Safety', link: '/guide/file-locking' },
            { text: 'Knowledge Artifacts', link: '/guide/knowledge-artifacts' },
            { text: 'Live Watch & Observability', link: '/guide/live-watch' },
          ],
        },
        {
          text: 'Extensibility',
          items: [{ text: 'Harness Adapters', link: '/guide/harness-adapters' }],
        },
      ],
      '/reference/': [
        {
          text: 'Reference',
          items: [
            { text: 'CLI Commands', link: '/reference/cli' },
            { text: 'Workflow Schema', link: '/reference/workflow-schema' },
            { text: 'Plugin Tools & APIs', link: '/reference/plugin-tools' },
          ],
        },
      ],
    },
    socialLinks: [{ icon: 'github', link: 'https://github.com/errevion/crewmate' }],
    search: {
      provider: 'local',
    },
    footer: {
      message: 'Released under the MIT license',
    },
  },
});
