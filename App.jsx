import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

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

async function idbGet(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(id);
    req.onsuccess = () => resolve(req.result || null);
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

function compareDates(a, b) {
  if (!a || !b) return 0;
  return a < b ? -1 : a > b ? 1 : 0;
}

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Latin-safe string for pdf-lib standard fonts
function sanitizeForPdf(str) {
  if (str == null) return '';
  return String(str).replace(/[^\x00-\xFF]/g, '?');
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
  // Language (already persisted via useEffect below)
  const [language, setLanguage] = useState(() => {
    const saved = localStorage.getItem('app_language');
    return saved === 'bn' ? 'bn' : 'en';
  });

  const [tenderData, setTenderData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // PDF state
  const [pdfMeta, setPdfMeta] = useState([]);
  const [uploadError, setUploadError] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  // Matching state
  const [matches, setMatches] = useState(() => {
    try {
      const saved = localStorage.getItem('requirement_matches');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const [expiries, setExpiries] = useState(() => {
    try {
      const saved = localStorage.getItem('requirement_expiries');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  // Search / filter
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'missing' | 'ok' | 'blocking'

  // Drag-from-list state
  const [draggedFileId, setDraggedFileId] = useState(null);
  const [dragOverReqId, setDragOverReqId] = useState(null);

  // Generation state
  const [generating, setGenerating] = useState(false);
  const [generatedPdfUrl, setGeneratedPdfUrl] = useState(null);
  const [generatedCsvUrl, setGeneratedCsvUrl] = useState(null);
  const [generatedFileName, setGeneratedFileName] = useState('');
  const [generationError, setGenerationError] = useState(null);

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

  // Recalculate duplicates
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
    const confirmed = window.confirm(
      language === 'bn'
        ? 'আপনি কি নিশ্চিত? সব আপলোড করা ফাইল, ম্যাচ এবং মেয়াদ মুছে যাবে।'
        : 'Are you sure? All uploaded files, matches, and expiry dates will be removed.'
    );
    if (!confirmed) return;
    setPdfMeta([]);
    setMatches({});
    setExpiries({});
    setGeneratedPdfUrl(null);
    setGeneratedCsvUrl(null);
    setGeneratedFileName('');
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

  // Drag & drop from file list to requirement row
  const handleFileDragStart = (e, fileId) => {
    setDraggedFileId(fileId);
    try {
      e.dataTransfer.setData('text/plain', fileId);
      e.dataTransfer.effectAllowed = 'move';
    } catch (_) {}
  };

  const handleReqDragOver = (e, reqId) => {
    if (!draggedFileId) return;
    e.preventDefault();
    e.stopPropagation();
    setDragOverReqId(reqId);
  };

  const handleReqDragLeave = (e, reqId) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverReqId((prev) => (prev === reqId ? null : prev));
  };

  const handleReqDrop = (e, reqId) => {
    e.preventDefault();
    e.stopPropagation();
    let fileId = draggedFileId;
    try {
      const dtId = e.dataTransfer.getData('text/plain');
      if (dtId) fileId = dtId;
    } catch (_) {}
    setDragOverReqId(null);
    setDraggedFileId(null);
    if (!fileId) return;
    const file = pdfMeta.find((f) => f.id === fileId);
    if (!file) return;
    if (!isFileUsable(file)) return;
    // one file -> one requirement: remove any existing assignment
    const matchedElsewhere = Object.entries(matches).find(
      ([k, v]) => v === fileId && k !== reqId
    );
    if (matchedElsewhere) {
      // replace: remove from old requirement
      setMatches((prev) => {
        const next = { ...prev };
        for (const k of Object.keys(next)) {
          if (next[k] === fileId) delete next[k];
        }
        next[reqId] = fileId;
        return next;
      });
    } else {
      handleMatchChange(reqId, fileId);
    }
  };

  const matchedFileIds = useMemo(() => {
    return new Set(Object.values(matches).filter(Boolean));
  }, [matches]);

  const isFileUsable = (f) => !f.duplicateOf && !f.error;

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

      if (req.has_expiry) {
        if (!expiry) {
          result[req.id] = { key: 'expiryNeeded', blocking: true };
          continue;
        }
        const cmp = compareDates(expiry, SUBMISSION_DEADLINE);
        if (cmp < 0) {
          result[req.id] = { key: 'expired', blocking: true };
          continue;
        }
        result[req.id] = { key: 'ok', blocking: false };
      } else {
        result[req.id] = { key: 'ok', blocking: false };
      }
    }
    return result;
  }, [sortedRequirements, matches, pdfMeta, expiries]);

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

  const canGenerate = blockingReasons.length === 0 && !generating;

  // Progress metrics
  const totalReqs = sortedRequirements.length;
  const okCount = useMemo(
    () =>
      sortedRequirements.filter((r) => requirementStatuses[r.id]?.key === 'ok').length,
    [sortedRequirements, requirementStatuses]
  );
  const blockingCount = blockingReasons.length;
  const progressPercent = totalReqs > 0 ? Math.round((okCount / totalReqs) * 100) : 0;

  // Filtered requirements for display
  const filteredRequirements = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sortedRequirements.filter((req) => {
      const st = requirementStatuses[req.id] || { key: 'notProvided', blocking: false };

      // Filter by status
      if (statusFilter === 'missing' && st.key !== 'missing' && st.key !== 'expired')
        return false;
      if (statusFilter === 'ok' && st.key !== 'ok') return false;
      if (statusFilter === 'blocking' && !st.blocking) return false;

      // Search by title (both languages)
      if (q) {
        const en = (req.title_en || '').toLowerCase();
        const bn = (req.title_bn || '').toLowerCase();
        const id = (req.id || '').toLowerCase();
        if (!en.includes(q) && !bn.includes(q) && !id.includes(q)) return false;
      }
      return true;
    });
  }, [sortedRequirements, requirementStatuses, searchQuery, statusFilter]);

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

    generateBtn: language === 'bn' ? 'ডকুমেন্ট জেনারেট করুন' : 'Generate Document',
    generating: language === 'bn' ? 'জেনারেট হচ্ছে...' : 'Generating...',
    cannotGenerate: language === 'bn' ? 'জেনারেট করা যাবে না' : 'Cannot generate',
    fixIssues: language === 'bn' ? 'নিচের সমস্যাগুলো ঠিক করুন:' : 'Fix the following issues:',

    generatedTitle: language === 'bn' ? 'জেনারেট করা প্যাকেজ' : 'Generated Package',
    preview: language === 'bn' ? 'প্রিভিউ' : 'Preview',
    downloadPdf: language === 'bn' ? 'পিডিএফ ডাউনলোড করুন' : 'Download PDF',
    downloadCsv: language === 'bn' ? 'CSV ডাউনলোড করুন' : 'Download CSV',
    generationFailed: language === 'bn' ? 'জেনারেশন ব্যর্থ হয়েছে' : 'Generation failed',

    searchPlaceholder: language === 'bn' ? 'শিরোনাম বা আইডি দিয়ে খুঁজুন...' : 'Search by title or ID...',
    filterAll: language === 'bn' ? 'সব' : 'All',
    filterMissing: language === 'bn' ? 'অনুপস্থিত' : 'Missing',
    filterOk: language === 'bn' ? 'ঠিক আছে' : 'OK',
    filterBlocking: language === 'bn' ? 'ব্লকিং' : 'Blocking Only',
    noMatches: language === 'bn' ? 'কোনো শর্ত মেলেনি' : 'No requirements match your filters',

    progressReady: language === 'bn' ? 'প্যাকেজ প্রস্তুত' : 'Package Ready',
    documentsOk: language === 'bn' ? 'ডকুমেন্ট ঠিক আছে' : 'documents OK',
    blockingIssues: language === 'bn' ? 'ব্লকিং সমস্যা' : 'blocking issues',
    noBlockingIssues: language === 'bn' ? 'কোনো ব্লকিং সমস্যা নেই' : 'No blocking issues',

    dragHint: language === 'bn' ? 'ড্র্যাগ করে ম্যাচ করুন' : 'Drag onto row to match',
  };

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

  // ---------- Generate Package ----------
  const handleGenerate = async () => {
    setGenerating(true);
    setGenerationError(null);
    setGeneratedPdfUrl(null);
    setGeneratedCsvUrl(null);

    try {
      const { tender } = tenderData;

      // Collect OK requirements with files
      const okItems = [];
      for (const req of sortedRequirements) {
        const st = requirementStatuses[req.id];
        if (!st || st.key !== 'ok') continue;
        const fileId = matches[req.id];
        if (!fileId) continue;
        const fileMeta = pdfMeta.find((f) => f.id === fileId);
        if (!fileMeta) continue;
        if (fileMeta.duplicateOf || fileMeta.error) continue;
        okItems.push({ req, fileMeta });
      }

      // Console verification log
      console.log('=== Tender Package Generation ===');
      console.log('Tender ID:', tender.tender_id);
      console.log('Total requirements:', sortedRequirements.length);
      console.log('OK items to merge:', okItems.length);
      sortedRequirements.forEach((req) => {
        const fileId = matches[req.id];
        const fileMeta = fileId ? pdfMeta.find((f) => f.id === fileId) : null;
        const st = requirementStatuses[req.id];
        console.log(
          `[${req.order}] ${req.id} | File: ${fileMeta ? fileMeta.name : '(none)'} | Expiry: ${
            expiries[req.id] || '(none)'
          } | Status: ${st?.key || 'unknown'}`
        );
      });

      // Create final PDF
      const finalPdf = await PDFDocument.create();
      const fontRegular = await finalPdf.embedFont(StandardFonts.Helvetica);
      const fontBold = await finalPdf.embedFont(StandardFonts.HelveticaBold);

      const pageWidth = 595.28;
      const pageHeight = 841.89;
      const margin = 50;

      // Try to embed logo
      let logoImage = null;
      try {
        const logoRes = await fetch('/company_logo.png');
        if (logoRes.ok) {
          const logoBytes = await logoRes.arrayBuffer();
          try {
            logoImage = await finalPdf.embedPng(logoBytes);
          } catch (e) {
            try {
              logoImage = await finalPdf.embedJpg(logoBytes);
            } catch (e2) {
              logoImage = null;
            }
          }
        }
      } catch (e) {
        logoImage = null;
      }

      // ---------- COVER PAGE ----------
      const cover = finalPdf.addPage([pageWidth, pageHeight]);
      let coverY = pageHeight - margin;

      if (logoImage) {
        const logoDim = logoImage.scale(0.5);
        const maxLogoW = 100;
        const maxLogoH = 100;
        let lw = logoDim.width;
        let lh = logoDim.height;
        if (lw > maxLogoW) {
          const r = maxLogoW / lw;
          lw *= r;
          lh *= r;
        }
        if (lh > maxLogoH) {
          const r = maxLogoH / lh;
          lw *= r;
          lh *= r;
        }
        cover.drawImage(logoImage, {
          x: (pageWidth - lw) / 2,
          y: coverY - lh,
          width: lw,
          height: lh,
        });
        coverY -= lh + 24;
      } else {
        coverY -= 20;
      }

      cover.drawText(sanitizeForPdf('Tender Submission Package'), {
        x: margin,
        y: coverY,
        size: 22,
        font: fontBold,
        color: rgb(0.1, 0.2, 0.5),
      });
      coverY -= 30;
      cover.drawText(sanitizeForPdf('/ টেন্ডার জমা প্যাকেজ'), {
        x: margin,
        y: coverY,
        size: 18,
        font: fontBold,
        color: rgb(0.1, 0.2, 0.5),
      });
      coverY -= 40;

      cover.drawLine({
        start: { x: margin, y: coverY },
        end: { x: pageWidth - margin, y: coverY },
        thickness: 1,
        color: rgb(0.7, 0.7, 0.7),
      });
      coverY -= 30;

      const labelEn = (en, bn) => (language === 'bn' ? bn : en);

      const addField = (label, value) => {
        cover.drawText(sanitizeForPdf(label), {
          x: margin,
          y: coverY,
          size: 11,
          font: fontBold,
          color: rgb(0.35, 0.35, 0.35),
        });
        coverY -= 16;
        const maxWidth = pageWidth - margin * 2;
        const valStr = sanitizeForPdf(value);
        const words = valStr.split(' ');
        let line = '';
        const lines = [];
        for (const w of words) {
          const test = line ? line + ' ' + w : w;
          const wWidth = fontRegular.widthOfTextAtSize(test, 14);
          if (wWidth > maxWidth && line) {
            lines.push(line);
            line = w;
          } else {
            line = test;
          }
        }
        if (line) lines.push(line);
        for (const l of lines) {
          cover.drawText(l, {
            x: margin,
            y: coverY,
            size: 14,
            font: fontRegular,
            color: rgb(0.1, 0.1, 0.1),
          });
          coverY -= 18;
        }
        coverY -= 10;
      };

      addField(labelEn('Tender ID', 'দরপত্র আইডি'), tender.tender_id);
      addField(
        labelEn('Title', 'শিরোনাম'),
        language === 'bn' && tender.title_bn ? tender.title_bn : tender.title
      );
      addField(
        labelEn
