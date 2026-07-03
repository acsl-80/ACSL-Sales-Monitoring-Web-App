
import React from 'react';

interface PasswordStrengthIndicatorProps {
  password: string;
}

const PasswordStrengthIndicator = ({ password }: PasswordStrengthIndicatorProps) => {
  const getStrength = (password: string) => {
    let score = 0;
    
    if (password.length >= 6) score += 1;
    if (password.length >= 8) score += 1;
    if (/[a-z]/.test(password)) score += 1;
    if (/[A-Z]/.test(password)) score += 1;
    if (/[0-9]/.test(password)) score += 1;
    if (/[^a-zA-Z0-9]/.test(password)) score += 1;
    
    return score;
  };

  const getStrengthLabel = (score: number) => {
    if (score < 2) return { label: 'Weak', color: 'bg-red-500' };
    if (score < 4) return { label: 'Fair', color: 'bg-yellow-500' };
    if (score < 5) return { label: 'Good', color: 'bg-blue-500' };
    return { label: 'Strong', color: 'bg-green-500' };
  };

  if (!password) return null;

  const strength = getStrength(password);
  const { label, color } = getStrengthLabel(strength);

  return (
    <div className="mt-1">
      <div className="flex items-center gap-2">
        <div className="flex-1 bg-gray-200 rounded-full h-2">
          <div 
            className={`h-2 rounded-full transition-all duration-300 ${color}`}
            style={{ width: `${(strength / 6) * 100}%` }}
          />
        </div>
        <span className="text-xs text-gray-600">{label}</span>
      </div>
      <div className="text-xs text-gray-500 mt-1">
        Requirements: Min 6 characters, mix of letters, numbers, and symbols
      </div>
    </div>
  );
};

export default PasswordStrengthIndicator;
