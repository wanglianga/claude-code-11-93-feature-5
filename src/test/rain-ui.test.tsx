// @vitest-environment jsdom
// 暴雨看板组件交互测试：真实点击流验证 UI 接线与题目主路径
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { RainWorkbench } from '../components/rain/RainWorkbench';

beforeEach(() => {
  window.localStorage.clear();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function publishR() {
  fireEvent.click(screen.getByTestId('check-window'));
  fireEvent.click(screen.getByTestId('check-estimate'));
  const btn = screen.getByTestId('publish-btn') as HTMLButtonElement;
  expect(btn.disabled).toBe(false);
  fireEvent.click(btn);
  expect(screen.getByTestId('published-card')).toBeTruthy();
}

describe('暴雨看板主路径（DOM 交互）', () => {
  it('初始建议 R；未核对不能发布；核对后发布仅含 R 一站', () => {
    render(React.createElement(RainWorkbench, { onOpenBaseline: () => {} }));
    expect(screen.getByTestId('suggested-id').textContent).toContain('R');
    expect((screen.getByTestId('publish-btn') as HTMLButtonElement).disabled).toBe(true);
    publishR();
    // H 没有被提前登记为 tasked/completed，仍可在增援区找到
    expect(screen.getByTestId('reinforce-H')).toBeTruthy();
  });

  it('司机合法称重 0.68t：09:36 完成 → U → 确认卸空后出现 10:09 二站拦截', () => {
    render(React.createElement(RainWorkbench, { onOpenBaseline: () => {} }));
    publishR();
    fireEvent.click(screen.getByTestId('role-driver'));

    fireEvent.click(screen.getByTestId('btn-arrive'));
    expect(screen.getByTestId('rain-clock').textContent).toBe('09:28');
    fireEvent.click(screen.getByTestId('btn-scan'));

    fireEvent.change(screen.getByTestId('weigh-input'), { target: { value: '0.68' } });
    fireEvent.click(screen.getByTestId('btn-weigh-submit'));
    expect(screen.getByTestId('completed-alert').textContent).toContain('09:36');

    fireEvent.click(screen.getByTestId('btn-transit-u'));
    expect(screen.getByTestId('rain-clock').textContent).toBe('09:46');
    fireEvent.click(screen.getByTestId('btn-confirm-empty'));
    expect(screen.getByTestId('empty-confirmed').textContent).toContain('确认卸空');
    expect(screen.getByTestId('empty-confirmed').textContent).toContain('10:09');
  });

  it('演示④实称 1.10t 超限：司机端停收，调度端建议失效并可重排', () => {
    render(React.createElement(RainWorkbench, { onOpenBaseline: () => {} }));
    publishR();
    fireEvent.click(screen.getByTestId('role-driver'));
    fireEvent.click(screen.getByTestId('btn-arrive'));
    fireEvent.click(screen.getByTestId('btn-scan'));

    fireEvent.click(screen.getByTestId('quick-overload')); // 填入 1.10
    fireEvent.click(screen.getByTestId('btn-weigh-submit'));
    expect(screen.getByTestId('overload-alert').textContent).toContain('停收');

    fireEvent.click(screen.getByTestId('role-dispatcher'));
    expect(screen.getByTestId('task-invalid').textContent).toContain('实称超限');
    fireEvent.click(screen.getByTestId('replan-btn'));
    expect(screen.getByTestId('replanned-card')).toBeTruthy();
    // R 仍在待服务列表
    expect(screen.getByTestId('pending-service').textContent).toContain('R');
  });

  it('演示①H 超吨后：人工强选 H 被硬约束拦截，不能发布', () => {
    render(React.createElement(RainWorkbench, { onOpenBaseline: () => {} }));
    fireEvent.click(screen.getByTestId('demo-h-over'));
    fireEvent.click(screen.getByTestId('check-window'));
    fireEvent.click(screen.getByTestId('check-estimate'));
    fireEvent.click(screen.getByTestId('toggle-manual'));
    fireEvent.click(screen.getByTestId('manual-pick-H'));
    fireEvent.change(screen.getByTestId('manual-reason-input'), {
      target: { value: '医院必须先做' },
    });
    const reval = screen.getByTestId('manual-revalidate').textContent ?? '';
    expect(reval).toContain('不通过');
    expect((screen.getByTestId('publish-btn') as HTMLButtonElement).disabled).toBe(true);
  });

  it('演示②R 截止提前后建议改 H；演示③补报要求重新核对估计', () => {
    render(React.createElement(RainWorkbench, { onOpenBaseline: () => {} }));
    fireEvent.click(screen.getByTestId('demo-r-early'));
    expect(screen.getByTestId('suggested-id').textContent).toContain('H');

    // 先核对两项，再注入③补报 → 估计核对 rev 失效
    fireEvent.click(screen.getByTestId('check-window'));
    fireEvent.click(screen.getByTestId('check-estimate'));
    fireEvent.click(screen.getByTestId('demo-backfill'));
    expect((screen.getByTestId('publish-btn') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('backfill-H')).toBeTruthy();
    // 依据 rev 变化后，窗口与估计两项都需在当前 rev 重新核对
    fireEvent.click(screen.getByTestId('check-window'));
    fireEvent.click(screen.getByTestId('check-estimate'));
    expect((screen.getByTestId('publish-btn') as HTMLButtonElement).disabled).toBe(false);
  });

  it('推进到 10:00：禁止发布，调度与司机都只剩撤离/交接确认', () => {
    render(React.createElement(RainWorkbench, { onOpenBaseline: () => {} }));
    fireEvent.click(screen.getByTestId('clock-1000'));
    expect(screen.getByTestId('post-cutoff-publish')).toBeTruthy();
    expect(screen.getByTestId('offboard-panel')).toBeTruthy();
    fireEvent.click(screen.getByTestId('ack-evac'));
    fireEvent.click(screen.getByTestId('ack-handover'));

    fireEvent.click(screen.getByTestId('role-driver'));
    expect(screen.getByTestId('driver-post-cutoff')).toBeTruthy();
  });
});
