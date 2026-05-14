export interface TemplatePreset {
  id: string;
  name: string;
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
  {
    id: 'peach',
    name: 'Peach',
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
    bgConfig: {
      style: 'solid',
      bgColor: '#FF7F50',
      gradEnd: '#FF6347',
      cardColor: '#FFF5F1',
    },
    typography: {
      textColor: '#4A0E0E',
      highlightColor: '#D00000',
      fontFamily: 'font-serif',
    }
  },
  {
    id: 'cream',
    name: 'Cream',
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
    bgConfig: {
      style: 'solid',
      bgColor: '#D2B48C',
      gradEnd: '#C19A6B',
      cardColor: '#FDF5E6',
    },
    typography: {
      textColor: '#4E342E',
      highlightColor: '#BF360C',
      fontFamily: 'font-serif',
    }
  },
  {
    id: 'mocha',
    name: 'Mocha',
    bgConfig: {
      style: 'solid',
      bgColor: '#6F4E37',
      gradEnd: '#3C2A21',
      cardColor: '#EAD8C0',
    },
    typography: {
      textColor: '#2C1810',
      highlightColor: '#FFD700',
      fontFamily: 'font-serif',
    }
  },
  {
    id: 'ocean-blue',
    name: 'Ocean Blue',
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
    bgConfig: {
      style: 'solid',
      bgColor: '#111827',
      gradEnd: '#1F2937',
      cardColor: '#374151',
    },
    typography: {
      textColor: '#F9FAFB',
      highlightColor: '#10B981',
      fontFamily: 'font-mono',
    }
  },
  {
    id: 'teal',
    name: 'Teal',
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
  }
];
