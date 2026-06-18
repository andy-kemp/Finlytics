import { useState, useCallback, useEffect } from 'react';

export function useToast() {
    const [toast, setToast] = useState(null);

    const showToast = useCallback((message, type = 'success') => {
        setToast({ message, type });
    }, []);

    const clearToast = useCallback(() => {
        setToast(null);
    }, []);

    useEffect(() => {
        if (!toast) return;
        const timer = setTimeout(() => setToast(null), 4500);
        return () => clearTimeout(timer);
    }, [toast]);

    return { toast, showToast, clearToast };
}
