// 登录页：四个演示账号（调度员 / T1 司机 / T2 司机 / 客服）
import React, { useState } from 'react';
import { ACCOUNTS } from '../lib/seed';
import type { Account } from '../types';

const ROLE_NAME: Record<string, string> = {
  dispatcher: '调度员',
  driver: '司机',
  cs: '客服',
};

export function Login({ onLogin }: { onLogin: (a: Account) => void }) {
  const [username, setUsername] = useState('dispatcher');
  const [password, setPassword] = useState('disp123');
  const [error, setError] = useState('');

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const acc = ACCOUNTS.find((a) => a.username === username && a.password === password);
    if (!acc) {
      setError('账号或密码错误');
      return;
    }
    onLogin(acc);
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h2>环卫线路工作台</h2>
        <p className="muted">封路重排 · 扫码回执 · 通知核查（浏览器端演示，数据存于 IndexedDB）</p>
        <label>账号</label>
        <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} />
        <label>密码</label>
        <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <div className="bad small">{error}</div>}
        <button className="btn primary block" type="submit">登录</button>
        <div className="acct-hints">
          {ACCOUNTS.map((a) => (
            <button key={a.id} type="button" className="chip"
              onClick={() => { setUsername(a.username); setPassword(a.password); setError(''); }}>
              {ROLE_NAME[a.role]} {a.name}{a.vehicleId ? `（${a.vehicleId}）` : ''}
              <span className="mono tiny"> {a.username}/{a.password}</span>
            </button>
          ))}
        </div>
      </form>
    </div>
  );
}
