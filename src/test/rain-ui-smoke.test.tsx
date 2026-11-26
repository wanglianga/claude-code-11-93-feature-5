// 临时 SSR 冒烟：验证暴雨看板渲染期无异常且关键题目文案/数值都进入 DOM
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import App from '../App';
import { RainProvider } from '../state/RainContext';
import { DispatcherRain } from '../components/rain/DispatcherRain';
import { DriverRain } from '../components/rain/DriverRain';

describe('rain UI SSR smoke', () => {
  it('整个 App 默认渲染暴雨调度台且包含全部关键数值', () => {
    const html = renderToStaticMarkup(React.createElement(App));
    for (const token of [
      '暴雨',
      '医院站',
      '普通街区站',
      '0.80',
      '0.95',
      '0.665',
      '100%',
      '缺报',
      '前一日实称',
      '满溢率上界优先',
      '09:36',
      '10:09',
      '09:40',
      '10:13',
      '1.465',
      '待增援',
      '预计失约',
      '人工改序',
      '确认卸空',
    ]) {
      expect(html, `缺少文案: ${token}`).toContain(token);
    }
  });

  it('调度员与司机面板均可独立渲染', () => {
    const h1 = renderToStaticMarkup(
      React.createElement(RainProvider, null, React.createElement(DispatcherRain)),
    );
    expect(h1).toContain('data-testid="dispatcher-view"');
    const h2 = renderToStaticMarkup(
      React.createElement(RainProvider, null, React.createElement(DriverRain)),
    );
    expect(h2).toContain('data-testid="driver-view"');
    expect(h2).toContain('没有已确认的首站任务');
  });
});
