import React from 'react';

export default function ComingSoon({ title, children }) {
    return (
        <div className="coming-soon">
            <h2>{title}</h2>
            <span className="coming-soon-badge">Coming soon</span>
            <p>{children}</p>
        </div>
    );
}
