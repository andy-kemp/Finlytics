import { useState, useRef, useEffect } from 'react';

export default function AutocompleteInput({ value, onChange, suggestions, style, placeholder }) {
  const [filtered, setFiltered] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapperRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleChange = (e) => {
    const val = e.target.value;
    onChange(val);
    if (val.length >= 2 && suggestions.length > 0) {
      const lower = val.toLowerCase();
      const matches = suggestions.filter(s => s.toLowerCase().includes(lower) && s.toLowerCase() !== lower);
      setFiltered(matches.slice(0, 8));
      setShowDropdown(matches.length > 0);
      setActiveIndex(-1);
    } else {
      setShowDropdown(false);
    }
  };

  const handleSelect = (item) => {
    onChange(item);
    setShowDropdown(false);
  };

  const handleKeyDown = (e) => {
    if (!showDropdown || filtered.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(prev => (prev < filtered.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(prev => (prev > 0 ? prev - 1 : filtered.length - 1));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      handleSelect(filtered[activeIndex]);
    } else if (e.key === 'Escape') {
      setShowDropdown(false);
    }
  };

  return (
    <div ref={wrapperRef} style={{ position: 'relative' }}>
      <input
        type="text"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => {
          if (value.length >= 2 && filtered.length > 0) setShowDropdown(true);
        }}
        style={style}
        placeholder={placeholder}
      />
      {showDropdown && filtered.length > 0 && (
        <ul style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 1000,
          background: '#fff', border: '1px solid #d1d5db', borderRadius: '0 0 6px 6px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.12)', maxHeight: 200, overflowY: 'auto',
          margin: 0, padding: 0, listStyle: 'none'
        }}>
          {filtered.map((item, i) => (
            <li
              key={item}
              onMouseDown={() => handleSelect(item)}
              style={{
                padding: '8px 10px', cursor: 'pointer', fontSize: '0.9rem',
                background: i === activeIndex ? '#e0e7ff' : '#fff',
                borderBottom: i < filtered.length - 1 ? '1px solid #f3f4f6' : 'none'
              }}
            >
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
