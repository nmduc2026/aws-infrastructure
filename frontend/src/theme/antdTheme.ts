import type { ThemeConfig } from 'antd'
import { theme as antTheme } from 'antd'

/** Phase 1: luôn light để khớp custom CSS (tránh filter-bar/card trắng trên nền dark). */
export function buildAntTheme(): ThemeConfig {
  return {
    algorithm: antTheme.defaultAlgorithm,
    token: {
      colorPrimary: '#1677ff',
      borderRadius: 8,
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      colorBgLayout: '#f0f2f5',
      colorText: '#141414',
      colorTextSecondary: '#595959',
      boxShadowTertiary:
        '0 1px 2px 0 rgba(0, 0, 0, 0.03), 0 1px 6px -1px rgba(0, 0, 0, 0.02), 0 2px 4px 0 rgba(0, 0, 0, 0.02)',
    },
    components: {
      Layout: {
        siderBg: '#ffffff',
        headerBg: '#ffffff',
        bodyBg: '#f0f2f5',
        triggerBg: '#fafafa',
      },
      Menu: {
        itemBorderRadius: 6,
        itemMarginInline: 8,
        itemHeight: 40,
      },
      Card: {
        paddingLG: 24,
      },
      Table: {
        headerBg: '#fafafa',
        borderColor: '#f0f0f0',
      },
      Button: {
        controlHeight: 36,
      },
    },
  }
}
