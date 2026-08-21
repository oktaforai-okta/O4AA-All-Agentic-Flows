import React from 'react';
import { login } from '../api.js';

export default function Login() {
  return (
    <div className="login">
      <div className="login-card">
        <h1>Okta for AI - Use Case Patterns</h1>
        <p>
          Sign in to chat with an agent that uses <strong>Okta Cross-App Access</strong>,{' '}
          <strong>Secrets</strong>, <strong>Service accounts</strong>, or{' '}
          <strong>Agent-to-Agent</strong> access to reach a protected API via MCP.
        </p>
        <button className="btn-primary" onClick={login}>
          Sign in with Okta
        </button>
      </div>
    </div>
  );
}
