import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

// Constants
const MAX_FILES = 30;
const MAX_TOTAL_SIZE = 50 * 1024 * 1024; // 50 MB
const SUBMISSION_DEADLINE = '2026-10-20';

// ---------- IndexedDB helpers ----------
const DB_NAME = 'mt_tender_db';
const DB_VERSION = 1;
const STORE_NAME = 'pdf_files';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(record) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbGetAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

async function idbDelete(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbClear() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---------- Utilities ----------
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function sha256Hex(arrayBuffer) {
  try {
    if (window.crypto && window.crypto.subtle) {
      const hash = await window.crypto.subtle.digest('SHA-256', arrayBuffer);
      return Array.from(new Uint8Array(hash))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    }
  } catch (e) {
    // fall through
  }
  const bytes = new Uint8Array(arrayBuffer);
  let h = 2166136261;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 16777619);
  }
  return 'fnv_' + (h >>> 0).toString(16);
}

const isPdfFile = (file) => {
  const nameOk = file.name.toLowerCase().endsWith('.pdf');
  const mimeOk = file.type === 'application/pdf';
  return nameOk && (mimeOk || file.type === '' || file.type === 'application/octet-stream');
};

// Compare ISO date strings (YYYY-MM-DD). Returns -1/0/1
function compareDates(a, b) {
  if (!a || !b) return 0;
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------- MT Logo ----------
const MTLogo = () => {
  const [logoError, setLogoError] = useState(false);

  if (logoError) {
    return (
      <div className="w-12 h-12 rounded-full bg-blue-700 flex items-center justify-center text-white font-bold text-xl shadow-md">
        MT
      </div>
    );
  }

  return (
    <img
      src="/company_logo.png"
      alt="MT Logo"
      className="w-12 h-12 rounded-full object-cover shadow-md"
      onError={() => setLogoError(true)}
    />
  );
};

// ---------- Main App ----------
function App() {
  // Language
  const [language, setLanguage] = useState(() => {
    const saved = localStorage.getItem('app_language');
    return saved === 'bn' ? 'bn' : 'en';
  });

  // Tender data
  const [tenderData, setTenderData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // PDF state
  const [pdfMeta, setPdfMeta] = useState([]);
  const [uploadError, setUploadError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  // Matching state: { [requirementId]: fileId }
  const [matches, setMatches] = useState(() => {
    try {
      const saved = localStorage.getItem('requirement_matches');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // Expiry dates: { [requirementId]: 'YYYY-MM-DD' }
  const [expiries, setExpiries] = useState(() => {
    try {
      const saved = localStorage.getItem('requirement_expiries');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // Persist language
  useEffect(() => {
    localStorage.setItem('app_language', language);
  }, [language]);

  // Persist pdf metadata
  useEffect(() => {
    try {
      localStorage.setItem('pdf_meta', JSON.stringify(pdfMeta));
    } catch (e) {
      console.warn('Failed to save pdf_meta:', e);
    }
  }, [pdfMeta]);

  // Persist matches
  useEffect(() => {
    try {
      localStorage.setItem('requirement_matches', JSON.stringify(matches));
    } catch (e) {
      console.warn('Failed to save matches:', e);
    }
  }, [matches]);

  // Persist expiries
  useEffect(() => {
    try {
      localStorage.setItem('requirement_expiries', JSON.stringify(expiries));
    } catch (e) {
      console.warn('Failed to save expiries:', e);
    }
  }, [expiries]);

  // Load tender
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const response = await fetch('/requirements.json');
        if (!response.ok) {
          throw new Error(`Failed to load requirements.json: ${response.status}`);
        }
        const data = await response.json();
        if (!data.tender || !Array.isArray(data.requirements)) {
          throw new Error('Invalid data format: missing tender or requirements array');
        }
        setTenderData(data);
        setError(null);
      } catch (err) {
        console.error('Error loading data:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    loadData();
  }, []);

  // Restore PDFs from IndexedDB
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const records = await idbGetAll();
        if (cancelled) return;
        if (records && records.length > 0) {
          const restored = records
            .sort((a, b) => (a.uploadedAt || 0) - (b.uploadedAt || 0))
            .map((r) => ({
              id: r.id,
              name: r.name,
              size: r.size,
              pages: r.pages,
              hash: r.hash,
              duplicateOf: null,
              error: r.error || null,
            }));
          setPdfMeta(restored);
        }
      } catch (e) {
        console.warn('Failed to restore PDFs from IndexedDB:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Recalculate duplicates whenever pdfMeta length changes
  useEffect(() => {
    setPdfMeta((prev) => {
      const hashFirst = new Map();
      const next = prev.map((item) => ({ ...item }));
      next.forEach((item, idx) => {
        if (!item.hash) {
          item.duplicateOf = null;
          return;
        }
        if (!hashFirst.has(item.hash)) {
          hashFirst.set(item.hash, idx);
          item.duplicateOf = null;
        } else {
          const firstIdx = hashFirst.get(item.hash);
          item.duplicateOf = next[firstIdx].name;
        }
      });
      const changed = prev.some(
        (p, i) => (p.duplicateOf || null) !== (next[i].duplicateOf || null)
      );
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfMeta.length]);

  const toggleLanguage = () => {
    setLanguage((prev) => (prev === 'en' ? 'bn' : 'en'));
  };

  const sortedRequirements = useMemo(() => {
    if (!tenderData?.requirements) return [];
    return [...tenderData.requirements].sort((a, b) => (a.order || 0) - (b.order || 0));
  }, [tenderData]);

  const getTitle = (item) => {
    if (language === 'bn') {
      return item.title_bn || item.title_en || '—';
    }
    return item.title_en || item.title_bn || '—';
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr;
      return date.toLocaleDateString(language === 'bn' ? 'bn-BD' : 'en-GB', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  // ---------- PDF Upload ----------
  const processFiles = useCallback(
    async (fileList) => {
      setUploadError(null);
      const incoming = Array.from(fileList || []);
      if (incoming.length === 0) return;

      if (pdfMeta.length + incoming.length > MAX_FILES) {
        setUploadError(
          language === 'bn'
            ? `সর্বোচ্চ ${MAX_FILES}টি ফাইল আপলোড করা যাবে। বর্তমানে ${pdfMeta.length}টি আছে।`
            : `Maximum ${MAX_FILES} files allowed. You already have ${pdfMeta.length}.`
        );
        return;
      }

      const currentSize = pdfMeta.reduce((sum, f) => sum + (f.size || 0), 0);
      const incomingSize = incoming.reduce((sum, f) => sum + f.size, 0);
      if (currentSize + incomingSize > MAX_TOTAL_SIZE) {
        setUploadError(
          language === 'bn'
            ? `মোট ${formatBytes(MAX_TOTAL_SIZE)} এর বেশি আপলোড করা যাবে না।`
            : `Total upload size cannot exceed ${formatBytes(MAX_TOTAL_SIZE)}.`
        );
        return;
      }

      setUploading(true);
      const newItems = [];

      for (const file of incoming) {
        if (!isPdfFile(file)) {
          const msg =
            language === 'bn'
              ? `শুধুমাত্র পিডিএফ অনুমোদিত: ${file.name}`
              : `Only PDF allowed: ${file.name}`;
          setUploadError(msg);
          continue;
        }

        const id =
          Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);

        let pages = null;
        let readError = null;
        let hash = null;

        try {
          const arrayBuffer = await file.arrayBuffer();
          hash = await sha256Hex(arrayBuffer.slice(0));

          const pdfData = new Uint8Array(arrayBuffer.slice(0));
          const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
          pages = pdf.numPages;
          try {
            pdf.destroy();
          } catch (_) {}
        } catch (err) {
          console.error('PDF read error:', err);
          readError =
            language === 'bn'
              ? `ফাইল পড়া যায়নি: ক্ষতিগ্রস্ত বা সুরক্ষিত - ${file.name}`
              : `Cannot read file: damaged or protected - ${file.name}`;
        }

        const item = {
          id,
          name: file.name,
          size: file.size,
          pages,
          hash,
          duplicateOf: null,
          error: readError,
          uploadedAt: Date.now(),
        };

        try {
          await idbPut({
            id,
            name: file.name,
            size: file.size,
            pages,
            hash,
            error: readError,
            uploadedAt: item.uploadedAt,
            blob: file,
          });
        } catch (e) {
          console.warn('Failed to persist file to IndexedDB:', e);
        }

        newItems.push(item);
      }

      if (newItems.length > 0) {
        setPdfMeta((prev) => [...prev, ...newItems]);
      }
      setUploading(false);
    },
    [pdfMeta, language]
  );

  const handleFileInput = (e) => {
    const files = e.target.files;
    if (files && files.length > 0) processFiles(files);
    e.target.value = '';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) processFiles(files);
  };

  const handleRemove = async (id) => {
    setPdfMeta((prev) => prev.filter((f) => f.id !== id));
    // Also remove any match referencing this file
    setMatches((prev) => {
      const next = { ...prev };
      for (const reqId of Object.keys(next)) {
        if (next[reqId] === id) delete next[reqId];
      }
      return next;
    });
    try {
      await idbDelete(id);
    } catch (e) {
      console.warn('Failed to delete from IndexedDB:', e);
    }
  };

  const handleClearAll = async () => {
    setPdfMeta([]);
    setMatches({});
    setExpiries({});
    try {
      await idbClear();
    } catch (e) {
      console.warn('Failed to clear IndexedDB:', e);
    }
  };

  // ---------- Matching ----------
  const handleMatchChange = (reqId, fileId) => {
    setMatches((prev) => {
      const next = { ...prev };
      if (!fileId) {
        delete next[reqId];
      } else {
        // Remove fileId from any other requirement
        for (const k of Object.keys(next)) {
          if (next[k] === fileId) delete next[k];
        }
        next[reqId] = fileId;
      }
      return next;
    });
  };

  const handleClearMatch = (reqId) => {
    setMatches((prev) => {
      const next = { ...prev };
      delete next[reqId];
      return next;
    });
    setExpiries((prev) => {
      const next = { ...prev };
      delete next[reqId];
      return next;
    });
  };

  const handleExpiryChange = (reqId, value) => {
    setExpiries((prev) => ({ ...prev, [reqId]: value }));
  };

  // Files currently matched (set of fileIds)
  const matchedFileIds = useMemo(() => {
    return new Set(Object.values(matches).filter(Boolean));
  }, [matches]);

  // A file is "usable" only if it's not a duplicate AND has no read error
  const isFileUsable = (f) => !f.duplicateOf && !f.error;

  // Check if a specific file can be assigned to a specific requirement
  const canAssignFile = (reqId, fileId) => {
    const file = pdfMeta.find((f) => f.id === fileId);
    if (!file) return false;
    if (!isFileUsable(file)) return false;
    const currentMatch = matches[reqId];
    if (currentMatch === fileId) return true;
    // Check if already matched to another requirement
    for (const k of Object.keys(matches)) {
      if (k !== reqId && matches[k] === fileId) return false;
    }
    return true;
  };

  // Compute status for each requirement
  const requirementStatuses = useMemo(() => {
    const result = {};
    for (const req of sortedRequirements) {
      const fileId = matches[req.id];
      const file = fileId ? pdfMeta.find((f) => f.id === fileId) : null;
      const expiry = expiries[req.id] || '';

      if (!file) {
        if (req.mandatory) {
          result[req.id] = { key: 'missing', blocking: true };
        } else {
          result[req.id] = { key: 'notProvided', blocking: false };
        }
        continue;
      }

      // File matched. Check if expiry date needed.
      if (req.has_expiry) {
        if (!expiry) {
          result[req.id] = { key: 'expiryNeeded', blocking: true };
          continue;
        }
        // Expired if expiry < submission deadline
        const cmp = compareDates(expiry, SUBMISSION_DEADLINE);
        if (cmp < 0) {
          result[req.id] = { key: 'expired', blocking: true };
          continue;
        }
        result[req.id] = { key: 'ok', blocking: false };
      } else {
        // No expiry needed
        result[req.id] = { key: 'ok', blocking: false };
      }
    }
    return result;
  }, [sortedRequirements, matches, pdfMeta, expiries]);

  // Blocking list for generate button
  const blockingReasons = useMemo(() => {
    const list = [];
    for (const req of sortedRequirements) {
      const st = requirementStatuses[req.id];
      if (st?.blocking) {
        list.push({
          reqId: req.id,
          order: req.order,
          title: getTitle(req),
          statusKey: st.key,
        });
      }
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requirementStatuses, sortedRequirements, language]);

  const canGenerate = blockingReasons.length === 0;

  // ---------- Translations ----------
  const t = {
    pdfSectionTitle: language === 'bn' ? 'পিডিএফ ডকুমেন্ট' : 'PDF Documents',
    pdfSectionSubtitle:
      language === 'bn'
        ? `সর্বোচ্চ ${MAX_FILES}টি ফাইল, মোট ${formatBytes(MAX_TOTAL_SIZE)}`
        : `Max ${MAX_FILES} files, total ${formatBytes(MAX_TOTAL_SIZE)}`,
    uploadBtn: language === 'bn' ? 'পিডিএফ আপলোড করুন' : 'Upload PDFs',
    dragDrop: language === 'bn' ? 'এখানে ড্র্যাগ ও ড্রপ করুন' : 'Drag & drop files here',
    orClick: language === 'bn' ? 'অথবা ক্লিক করুন' : 'or click to browse',
    uploading: language === 'bn' ? 'আপলোড হচ্ছে...' : 'Uploading...',
    uploadedFiles: language === 'bn' ? 'আপলোড করা ফাইল' : 'Uploaded Files',
    clearAll: language === 'bn' ? 'সব মুছুন' : 'Clear All',
    pages: language === 'bn' ? 'পৃষ্ঠা' : 'pages',
    remove: language === 'bn' ? 'মুছুন' : 'Remove',
    duplicate: language === 'bn' ? 'ডুপ্লিকেট' : 'Duplicate',
    duplicateOf: language === 'bn' ? 'এর ডুপ্লিকেট:' : 'Duplicate of',
    damaged: language === 'bn' ? 'ক্ষতিগ্রস্ত' : 'Damaged',

    matchWithFile: language === 'bn' ? 'ফাইল নির্বাচন করুন' : 'Match with file',
    selectFilePlaceholder: language === 'bn' ? '— ফাইল নির্বাচন করুন —' : '— Select a file —',
    clear: language === 'bn' ? 'মুছুন' : 'Clear',
    expiryDate: language === 'bn' ? 'মেয়াদ শেষের তারিখ' : 'Expiry date',
    status: language === 'bn' ? 'স্ট্যাটাস' : 'Status',

    statusMissing: language === 'bn' ? 'অনুপস্থিত' : 'Missing',
    statusExpiryNeeded: language === 'bn' ? 'মেয়াদ তারিখ প্রয়োজন' : 'Expiry date needed',
    statusExpired: language === 'bn' ? 'মেয়াদোত্তীর্ণ' : 'Expired',
    statusNotProvided: language === 'bn' ? 'প্রদান করা হয়নি' : 'Not provided',
    statusOk: language === 'bn' ? 'ঠিক আছে' : 'OK',

    blocking: language === 'bn' ? 'ব্লকিং' : 'blocking',
    nonBlocking: language === 'bn' ? 'ব্লকিং নয়' : 'not blocking',

    generateBtn: language === 'bn' ? 'ডকুমেন্ট জেনারেট করুন' : 'Generate Document',
    cannotGenerate: language === 'bn' ? 'জেনারেট করা যাবে না' : 'Cannot generate',
    fixIssues: language === 'bn' ? 'নিচের সমস্যাগুলো ঠিক করুন:' : 'Fix the following issues:',
  };

  // Status label + colors
  const statusDisplay = (key) => {
    switch (key) {
      case 'missing':
        return { label: t.statusMissing, cls: 'bg-red-100 text-red-800 border-red-300' };
      case 'expiryNeeded':
        return {
          label: t.statusExpiryNeeded,
          cls: 'bg-orange-100 text-orange-800 border-orange-300',
        };
      case 'expired':
        return { label: t.statusExpired, cls: 'bg-red-100 text-red-800 border-red-300' };
      case 'notProvided':
        return {
          label: t.statusNotProvided,
          cls: 'bg-gray-100 text-gray-700 border-gray-300',
        };
      case 'ok':
        return { label: t.statusOk, cls: 'bg-green-100 text-green-800 border-green-300' };
      default:
        return { label: '—', cls: 'bg-gray-100 text-gray-700 border-gray-300' };
    }
  };

  // ---------- Loading / Error ----------
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-2xl text-gray-600 font-medium">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md text-center">
          <div className="text-red-500 text-5xl mb-4">⚠️</div>
          <h1 className="text-2xl font-bold text-gray-800 mb-2">Error Loading Data</h1>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    );
  }

  const { tender } = tenderData;

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white shadow-md sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MTLogo />
            <div>
              <h1 className="text-xl font-bold text-gray-800 leading-tight">
                {language === 'bn' ? 'এমটি টেন্ডার পোর্টাল' : 'MT Tender Portal'}
              </h1>
              <p className="text-sm text-gray-500">
                {language === 'bn' ? 'দরপত্র ব্যবস্থাপনা' : 'Tender Management'}
              </p>
            </div>
          </div>

          <button
            onClick={toggleLanguage}
            className="px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold text-lg transition-colors shadow-sm"
            aria-label="Toggle language"
          >
            EN | BN
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-8">
        {/* Tender Details */}
        <section className="bg-white rounded-xl shadow-md p-6 mb-8 border-l-4 border-blue-600">
          <div className="flex items-center gap-3 mb-4">
            <span className="bg-blue-100 text-blue-800 text-sm font-bold px-3 py-1 rounded-full">
              {tender.tender_id}
            </span>
            <span className="text-sm text-gray-500">
              {language === 'bn' ? 'দরপত্র আইডি' : 'Tender ID'}
            </span>
          </div>

          <h2 className="text-2xl md:text-3xl font-bold text-gray-900 mb-4">
            {language === 'bn' && tender.title_bn ? tender.title_bn : tender.title}
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm text-gray-500 mb-1">
                {language === 'bn' ? 'ক্রয়কারী প্রতিষ্ঠান' : 'Procuring Entity'}
              </p>
              <p className="text-lg font-semibold text-gray-800">
                {language === 'bn' && tender.procuring_entity_bn
                  ? tender.procuring_entity_bn
                  : tender.procuring_entity}
              </p>
            </div>

            <div className="bg-gray-50 rounded-lg p-4">
              <p className="text-sm text-gray-500 mb-1">
                {language === 'bn' ? 'নিবেদনকারী' : 'Bidder'}
              </p>
              <p className="text-lg font-semibold text-gray-800">
                {language === 'bn' && tender.bidder_bn ? tender.bidder_bn : tender.bidder}
              </p>
            </div>

            <div className="bg-gray-50 rounded-lg p-4 md:col-span-2">
              <p className="text-sm text-gray-500 mb-1">
                {language === 'bn' ? 'জমা দেওয়ার শেষ তারিখ' : 'Submission Deadline'}
              </p>
              <p className="text-lg font-semibold text-red-600">
                {formatDate(tender.submission_deadline)}
              </p>
            </div>
          </div>
        </section>

        {/* Requirements List */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-2xl font-bold text-gray-800">
              {language === 'bn' ? 'শর্তাবলী' : 'Requirements'}
            </h3>
            <span className="bg-gray-200 text-gray-700 text-sm font-semibold px-3 py-1 rounded-full">
              {sortedRequirements.length} {language === 'bn' ? 'টি' : 'items'}
            </span>
          </div>

          {sortedRequirements.length === 0 ? (
            <div className="bg-white rounded-xl shadow-md p-8 text-center text-gray-500 text-lg">
              {language === 'bn' ? 'কোনো শর্ত পাওয়া যায়নি' : 'No requirements found'}
            </div>
          ) : (
            <div className="space-y-4">
              {sortedRequirements.map((req) => {
                const st = requirementStatuses[req.id] || { key: 'notProvided', blocking: false };
                const disp = statusDisplay(st.key);
                const matchedFileId = matches[req.id] || '';
                const expiry = expiries[req.id] || '';

                return (
                  <div
                    key={req.id}
                    className={`bg-white rounded-xl shadow-md p-5 transition-shadow border-l-4 ${
                      st.blocking
                        ? st.key === 'expiryNeeded'
                          ? 'border-orange-400'
                          : 'border-red-500'
                        : st.key === 'ok'
                        ? 'border-green-500'
                        : 'border-gray-300'
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                      <div className="flex-shrink-0">
                        <div className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-lg">
                          {req.order}
                        </div>
                      </div>

                      <div className="flex-1 min-w-0">
                        <h4 className="text-xl font-semibold text-gray-900 mb-3">
                          {getTitle(req)}
                        </h4>

                        <div className="flex flex-wrap gap-2 mb-3">
                          <span
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold ${
                              req.mandatory
                                ? 'bg-red-100 text-red-800'
                                : 'bg-green-100 text-green-800'
                            }`}
                          >
                            <span
                              className={`w-2 h-2 rounded-full ${
                                req.mandatory ? 'bg-red-500' : 'bg-green-500'
                              }`}
                            ></span>
                            {req.mandatory
                              ? language === 'bn'
                                ? 'বাধ্যতামূলক'
                                : 'Mandatory'
                              : language === 'bn'
                              ? 'ঐচ্ছিক'
                              : 'Optional'}
                          </span>

                          <span
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold ${
                              req.has_expiry
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-gray-100 text-gray-600'
                            }`}
                          >
                            <span
                              className={`w-2 h-2 rounded-full ${
                                req.has_expiry ? 'bg-amber-500' : 'bg-gray-400'
                              }`}
                            ></span>
                            {req.has_expiry
                              ? language === 'bn'
                                ? 'মেয়াদ আছে'
                                : 'Has Expiry'
                              : language === 'bn'
                              ? 'মেয়াদ নেই'
                              : 'No Expiry'}
                          </span>

                          {/* Status badge */}
                          <span
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold border ${disp.cls}`}
                          >
                            {disp.label}
                            {st.blocking && (
                              <span className="text-xs font-semibold opacity-80">
                                ({t.blocking})
                              </span>
                            )}
                          </span>
                        </div>

                        {/* Match controls */}
                        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-sm font-semibold text-gray-600 mb-1">
                              {t.matchWithFile}
                            </label>
                            <div className="flex gap-2">
                              <select
                                value={matchedFileId}
                                onChange={(e) => handleMatchChange(req.id, e.target.value)}
                                className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-800 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
                              >
                                <option value="">{t.selectFilePlaceholder}</option>
                                {pdfMeta.map((f) => {
                                  const usable = isFileUsable(f);
                                  // Show as disabled if: not usable OR matched to another req
                                  const matchedElsewhere =
                                    matchedFileIds.has(f.id) && matches[req.id] !== f.id;
                                  const disabled = !usable || matchedElsewhere;
                                  let suffix = '';
                                  if (f.duplicateOf) suffix = ` (${t.duplicate})`;
                                  else if (f.error) suffix = ` (${t.damaged})`;
                                  return (
                                    <option
                                      key={f.id}
                                      value={f.id}
                                      disabled={disabled}
                                    >
                                      {f.name}
                                      {suffix}
                                    </option>
                                  );
                                })}
                              </select>

                              {matchedFileId && (
                                <button
                                  type="button"
                                  onClick={() => handleClearMatch(req.id)}
                                  className="px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold text-sm transition-colors"
                                >
                                  {t.clear}
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Expiry date input */}
                          {req.has_expiry && matchedFileId && (
                            <div>
                              <label className="block text-sm font-semibold text-gray-600 mb-1">
                                {t.expiryDate}
                              </label>
                              <input
                                type="date"
                                value={expiry}
                                onChange={(e) => handleExpiryChange(req.id, e.target.value)}
                                className="w-full px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-800 text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex-shrink-0 self-start">
                        <span className="text-xs text-gray-400 font-mono bg-gray-50 px-2 py-1 rounded">
                          {req.id}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ---------- PDF Upload Section ---------- */}
        <section className="mt-10">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <div>
              <h3 className="text-2xl font-bold text-gray-800">{t.pdfSectionTitle}</h3>
              <p className="text-sm text-gray-500">{t.pdfSectionSubtitle}</p>
            </div>
            {pdfMeta.length > 0 && (
              <button
                onClick={handleClearAll}
                className="px-4 py-2 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-700 font-semibold text-sm transition-colors"
              >
                {t.clearAll}
              </button>
            )}
          </div>

          {uploadError && (
            <div className="mb-4 bg-red-50 border-l-4 border-red-500 rounded-lg p-4 flex items-start gap-3">
              <span className="text-red-500 text-xl">⚠️</span>
              <p className="text-red-700 font-medium flex-1">{uploadError}</p>
             
