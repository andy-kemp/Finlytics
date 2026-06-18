import React, { useState } from 'react';
import { useMsal } from '@azure/msal-react';
import { loginRequest } from '../auth/authConfig';

function Login() {
    const { instance } = useMsal();
    const [email, setEmail] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (!email.trim()) {
            setError('Please enter your email address');
            return;
        }

        if (!email.includes('@')) {
            setError('Please enter a valid email address');
            return;
        }

        try {
            setLoading(true);
            await instance.loginRedirect({
                ...loginRequest,
                loginHint: email
            });
        } catch (error) {
            console.error('SSO login error:', error);
            setError('Failed to initiate login. Please try again.');
            setLoading(false);
        }
    };

    return (
        <div className="login-container">
            <div className="login-card">
                <h1>Finlytics</h1>
                <p>Sign in with your Microsoft account</p>
                {error && <div className="error-message">{error}</div>}
                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>Email Address</label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="your.email@company.com"
                            autoFocus
                            disabled={loading}
                            required
                        />
                    </div>
                    <button 
                        type="submit" 
                        className="btn-primary" 
                        disabled={loading}
                    >
                        {loading ? 'Signing in...' : 'Sign in with Microsoft'}
                    </button>
                </form>
            </div>
        </div>
    );
}

export default Login;
