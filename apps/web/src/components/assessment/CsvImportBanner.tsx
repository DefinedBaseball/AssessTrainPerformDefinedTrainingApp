'use client';

import styles from './assessment.module.css';

interface CsvImportBannerProps {
  title: string;
  subtitle: string;
  onFileSelect: (file: File) => void;
}

export function CsvImportBanner({ title, subtitle, onFileSelect }: CsvImportBannerProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onFileSelect(file);
    e.target.value = '';
  };

  return (
    <div className={styles.csvImport}>
      <div className={styles.csvImportLeft}>
        <span className={styles.csvImportIcon}>📂</span>
        <div className={styles.csvImportText}>
          <strong>{title}</strong>
          {subtitle}
        </div>
      </div>
      <label className={styles.csvImportBtn}>
        ↑ Import File
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          onChange={handleChange}
          style={{ display: 'none' }}
        />
      </label>
    </div>
  );
}
