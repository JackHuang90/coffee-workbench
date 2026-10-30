/** 功能：配置应用构建及源码测试。首次编写日期：未知（历史代码）。变更日期：2026-10-30。修改记录：2026-10-30 限定源码测试目录，并排除开发服务对固件缓存及发布副本的监听，避免 Windows 编译临时文件占用导致退出。 */
import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
export default defineConfig({
  plugins: [vue()],
  server: {
    watch: {
      ignored: [
        "**/firmware/.pio/**",
        "**/firmware/.tools/**",
        "**/firmware/build/**",
        "**/firmware/artifacts/**",
        "**/.sites-runtime/**",
      ],
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "happy-dom",
    setupFiles: ["./tests/setup.ts"],
  },
});
