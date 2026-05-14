export interface TemplatePreset {
  id: string;
  name: string;
  category: 'Bold' | 'Minimal' | 'Warm' | 'Cool' | 'Dark';
  bgConfig: {
    style: 'solid' | 'gradient';
    bgColor: string;
    gradEnd: string;
    cardColor: string;
  };
  typography: {
    textColor: string;
    highlightColor: string;
    fontFamily: string;
  };
}

export const TEMPLATE_PRESETS: TemplatePreset[] = [
  // BOLD
  {
    id: 'crimson',
    name: 'Crimson',
    category: 'Bold',
    bgConfig: {
      style: 'solid',
      bgColor: '#991B1B',
      gradEnd: '#7F1D1D',
      cardColor: '#FEF2F2',
    },
    typography: {
      textColor: '#7F1D1D',
      highlightColor: '#DC2626',
      fontFamily: 'font-merriweather',
    }
  },
  {
    id: 'gold',
    name: 'Gold',
    category: 'Bold',
    bgConfig: {
      style: 'solid',
      bgColor: '#B45309',
      gradEnd: '#92400E',
      cardColor: '#FFFBEB',
    },
    typography: {
      textColor: '#78350F',
      highlightColor: '#D97706',
      fontFamily: 'font-playfair',
    }
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    category: 'Bold',
    bgConfig: {
      style: 'gradient',
      bgColor: '#000000',
      gradEnd: '#1A1A1A',
      cardColor: '#1A1D23',
    },
    typography: {
      textColor: '#FFFFFF',
      highlightColor: '#F0ABFC',
      fontFamily: 'font-mono',
    }
  },
  {
    id: 'neon',
    name: 'Neon',
    category: 'Bold',
    bgConfig: {
      style: 'solid',
      bgColor: '#000000',
      gradEnd: '#000000',
      cardColor: '#111111',
    },
    typography: {
      textColor: '#4ADE80',
      highlightColor: '#A855F7',
      fontFamily: 'font-mono',
    }
  },

  // MINIMAL
  {
    id: 'pure-white',
    name: 'Pure White',
    category: 'Minimal',
    bgConfig: {
      style: 'solid',
      bgColor: '#FFFFFF',
      gradEnd: '#F9FAFB',
      cardColor: '#FFFFFF',
    },
    typography: {
      textColor: '#111827',
      highlightColor: '#6B7280',
      fontFamily: 'font-sans',
    }
  },
  {
    id: 'monochrome',
    name: 'Monochrome',
    category: 'Minimal',
    bgConfig: {
      style: 'solid',
      bgColor: '#F3F4F6',
      gradEnd: '#E5E7EB',
      cardColor: '#FFFFFF',
    },
    typography: {
      textColor: '#000000',
      highlightColor: '#4B5563',
      fontFamily: 'font-serif',
    }
  },

  // WARM
  {
    id: 'sunset',
    name: 'Sunset',
    category: 'Warm',
    bgConfig: {
      style: 'gradient',
      bgColor: '#FB923C',
      gradEnd: '#F43F5E',
      cardColor: '#FFF1F2',
    },
    typography: {
      textColor: '#881337',
      highlightColor: '#E11D48',
      fontFamily: 'font-serif',
    }
  },
  {
    id: 'peach',
    name: 'Peach',
    category: 'Warm',
    bgConfig: {
      style: 'solid',
      bgColor: '#FFCD94',
      gradEnd: '#FFB86C',
      cardColor: '#FFF8F0',
    },
    typography: {
      textColor: '#5D2E17',
      highlightColor: '#E63946',
      fontFamily: 'font-serif',
    }
  },
  {
    id: 'coral',
    name: 'Coral',
    category: 'Warm',
    bgConfig: {
      style: 'solid',
      bgColor: '#FF7F50',
      gradEnd: '#FF6347',
      cardColor: '#FFF5F1',
    },
    typography: {
      textColor: '#4A0E0E',
      highlightColor: '#D00000',
      fontFamily: 'font-merriweather',
    }
  },
  {
    id: 'cream',
    name: 'Cream',
    category: 'Warm',
    bgConfig: {
      style: 'solid',
      bgColor: '#F5F5DC',
      gradEnd: '#E6E6FA',
      cardColor: '#FFFFFF',
    },
    typography: {
      textColor: '#2D3436',
      highlightColor: '#00B894',
      fontFamily: 'font-serif',
    }
  },
  {
    id: 'beige',
    name: 'Beige',
    category: 'Warm',
    bgConfig: {
      style: 'solid',
      bgColor: '#D2B48C',
      gradEnd: '#C19A6B',
      cardColor: '#FDF5E6',
    },
    typography: {
      textColor: '#4E342E',
      highlightColor: '#BF360C',
      fontFamily: 'font-merriweather',
    }
  },
  {
    id: 'mocha',
    name: 'Mocha',
    category: 'Warm',
    bgConfig: {
      style: 'solid',
      bgColor: '#6F4E37',
      gradEnd: '#3C2A21',
      cardColor: '#EAD8C0',
    },
    typography: {
      textColor: '#2C1810',
      highlightColor: '#CD900D',
      fontFamily: 'font-merriweather',
    }
  },

  // COOL
  {
    id: 'ocean-blue',
    name: 'Ocean Blue',
    category: 'Cool',
    bgConfig: {
      style: 'solid',
      bgColor: '#1E3A8A',
      gradEnd: '#1E40AF',
      cardColor: '#EFF6FF',
    },
    typography: {
      textColor: '#1E3A8A',
      highlightColor: '#3B82F6',
      fontFamily: 'font-sans',
    }
  },
  {
    id: 'sky',
    name: 'Sky',
    category: 'Cool',
    bgConfig: {
      style: 'solid',
      bgColor: '#BAE6FD',
      gradEnd: '#7DD3FC',
      cardColor: '#F0F9FF',
    },
    typography: {
      textColor: '#0369A1',
      highlightColor: '#0284C7',
      fontFamily: 'font-sans',
    }
  },
  {
    id: 'navy',
    name: 'Navy',
    category: 'Cool',
    bgConfig: {
      style: 'solid',
      bgColor: '#1E293B',
      gradEnd: '#0F172A',
      cardColor: '#334155',
    },
    typography: {
      textColor: '#F8FAFC',
      highlightColor: '#38BDF8',
      fontFamily: 'font-mono',
    }
  },
  {
    id: 'teal',
    name: 'Teal',
    category: 'Cool',
    bgConfig: {
      style: 'solid',
      bgColor: '#134E4A',
      gradEnd: '#115E59',
      cardColor: '#F0FDFA',
    },
    typography: {
      textColor: '#134E4A',
      highlightColor: '#0D9488',
      fontFamily: 'font-sans',
    }
  },
  {
    id: 'mint',
    name: 'Mint',
    category: 'Cool',
    bgConfig: {
      style: 'solid',
      bgColor: '#DCFCE7',
      gradEnd: '#BBF7D0',
      cardColor: '#F0FDF4',
    },
    typography: {
      textColor: '#166534',
      highlightColor: '#10B981',
      fontFamily: 'font-sans',
    }
  },
  {
    id: 'emerald',
    name: 'Emerald',
    category: 'Cool',
    bgConfig: {
      style: 'solid',
      bgColor: '#064E3B',
      gradEnd: '#065F46',
      cardColor: '#ECFDF5',
    },
    typography: {
      textColor: '#064E3B',
      highlightColor: '#10B981',
      fontFamily: 'font-merriweather',
    }
  },

  // DARK
  {
    id: 'midnight',
    name: 'Midnight',
    category: 'Dark',
    bgConfig: {
      style: 'solid',
      bgColor: '#020617',
      gradEnd: '#0F172A',
      cardColor: '#1E293B',
    },
    typography: {
      textColor: '#F8FAFC',
      highlightColor: '#38BDF8',
      fontFamily: 'font-sans',
    }
  },
  {
    id: 'dark-forest',
    name: 'Dark Forest',
    category: 'Dark',
    bgConfig: {
      style: 'solid',
      bgColor: '#052E16',
      gradEnd: '#064E3B',
      cardColor: '#065F46',
    },
    typography: {
      textColor: '#F0FDF4',
      highlightColor: '#4ADE80',
      fontFamily: 'font-serif',
    }
  }
];
