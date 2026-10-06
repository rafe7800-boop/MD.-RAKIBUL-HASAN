
import React, { useState, useEffect, useMemo, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

pdfjsLib.GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

const MAX_FILES = 30;
const MAX_TOTAL_SIZE = 50 * 1024 * 1024;

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function sanitizeForPdf(str) {
  if (str == null) return '';
  return String(str).replace(/[^\x00-\xFF]/g, '?');
}

const MTLogo = () => {
  const [err, setErr] = useState(false);
  if (err) {
    return (
      <div className="w-12 h-12 rounded-full bg-[#0f4a5e] flex items-center justify-center text-white font-bold text-xl shadow-md">
        MT
      </div>
    );
  }
  return (
    <img
      src="./company_logo.png"
      alt="MT Logo"
      className="w-12 h-12 rounded-full object-cover shadow-md bg-white"
      onError={() => setErr(true)}
    />
  );
};

function App() {
  const [language, setLanguage] = useState(() => localStorage.getItem('app_language') || 'en');
  const [tenderData, setTenderData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pdfMeta, setPdfMeta] = useState([]);
  const [matches, setMatches] = useState(() => {
    try { return JSON.parse(localStorage.getItem('requirement_matches') || '{}'); } catch { return {}; }
  });
  const [expiries, setExpiries] = useState(() => {
    try { return JSON.parse(localStorage.getItem('requirement_expiries') || '{}'); } catch { return {}; }
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [uploadError, setUploadError] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatedPdfUrl, setGeneratedPdfUrl] = useState(null);
  const [genError, setGenError] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    localStorage.setItem('app_language', language);
  }, [language]);
  useEffect(() => {
    localStorage.setItem('requirement_matches', JSON.stringify(matches));
  }, [matches]);
  useEffect(() => {
    localStorage.setItem('requirement_expiries', JSON.stringify(expiries));
  }, [expiries]);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch('./requirements.json');
        if (!res.ok) throw new Error('Failed to load requirements.json');
        const data = await res.json();
        setTenderData(data);
      } catch (e) {
        // fallback to inline data
        const fallback = {
          tender: {
            tender_id: "T-2026-0417",
            title: "Supply of IT Equipment",
            procuring_entity: "Directorate of Sample Services",
            bidder: "Meghna Tech Solutions Ltd.",
            submission_deadline: "2026-10-20"
          },
          requirements: [
            { id: "R01", order: 1, title_en: "Trade License", title_bn: "ট্রেড লাইসেন্স", mandatory: true, has_expiry: true },
            { id: "R02", order: 2, title_en: "TIN Certificate", title_bn: "টিআইএন সনদ", mandatory: true, has_expiry: false },
            { id: "R03", order: 3, title_en: "VAT Registration Certificate", title_bn: "ভ্যাট নিবন্ধন সনদ", mandatory: true, has_expiry: false },
            { id: "R04", order: 4, title_en: "Bank Solvency Certificate", title_bn: "ব্যাংক সচ্ছলতা সনদ", mandatory: true, has_expiry: true },
            { id: "R05", order: 5, title_en: "Experience Certificate", title_bn: "অভিজ্ঞতার সনদ", mandatory: true, has_expiry: false },
            { id: "R06", order: 6, title_en: "Audited Financial Statement", title_bn: "নিরীক্ষিত আর্থিক বিবরণী", mandatory: false, has_expiry: false },
            { id: "R07", order: 7, title_en: "Manufacturer's Authorization", title_bn: "প্রস্তুতকারকের অনুমোদনপত্র", mandatory: false, has_expiry: true },
            { id: "R08", order: 8, title_en: "Technical Proposal", title_bn: "কারিগরি প্রস্তাব", mandatory: true, has_expiry: false },
            { id: "R09", order: 9, title_en: "Financial Proposal", title_bn: "আর্থিক প্রস্তাব", mandatory: true, has_expiry: false },
            { id: "R10", order: 10, title_en: "Signed Declaration", title_bn: "স্বাক্ষরিত ঘোষণাপত্র", mandatory: true, has_expiry: false }
          ]
        };
        setTenderData(fallback);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleFiles = async (files) => {
    setUploadError(null);
    const fileList = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.pdf'));
    if (fileList.length === 0) { setUploadError('Please upload PDF files only'); return; }
    if (pdfMeta.length + fileList.length > MAX_FILES) { setUploadError(`Max ${MAX_FILES} files allowed`); return; }
    const totalSize = pdfMeta.reduce((a,b)=>a+b.size,0) + fileList.reduce((a,b)=>a+b.size,0);
    if (totalSize > MAX_TOTAL_SIZE) { setUploadError('Total size exceeds 50 MB'); return; }

    const newMetas = fileList.map(f => ({
      id: Math.random().toString(36).slice(2) + Date.now(),
      name: f.name,
      size: f.size,
      file: f,
      createdAt: new Date().toISOString()
    }));
    setPdfMeta(prev => [...prev, ...newMetas]);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
  };

  const removeFile = (id) => {
    setPdfMeta(prev => prev.filter(f => f.id !== id));
    const newMatches = {...matches};
    Object.keys(newMatches).forEach(k => { if (newMatches[k] === id) delete newMatches[k]; });
    setMatches(newMatches);
  };

  const requirementStatuses = useMemo(() => {
    if (!tenderData) return {};
    const res = {};
    for (const req of tenderData.requirements) {
      const fileId = matches[req.id];
      const expiry = expiries[req.id];
      if (!fileId) {
        res[req.id] = req.mandatory ? { key: 'missing', label: language==='bn'?'অনুপস্থিত':'Missing' } : { key: 'optional', label: language==='bn'?'ঐচ্ছিক':'Optional' };
      } else {
        const isExpired = expiry && new Date(expiry) < new Date();
        if (isExpired) res[req.id] = { key: 'expired', label: language==='bn'?'মেয়াদোত্তীর্ণ':'Expired' };
        else res[req.id] = { key: 'ok', label: language==='bn'?'প্রস্তুত':'Ready' };
      }
    }
    return res;
  }, [tenderData, matches, expiries, language]);

  const filteredReqs = useMemo(() => {
    if (!tenderData) return [];
    return tenderData.requirements.filter(req => {
      const title = language==='bn' ? req.title_bn : req.title_en;
      const matchesSearch = title.toLowerCase().includes(searchQuery.toLowerCase()) || req.id.toLowerCase().includes(searchQuery.toLowerCase());
      const status = requirementStatuses[req.id]?.key;
      const matchesStatus = statusFilter === 'all' || status === statusFilter;
      return matchesSearch && matchesStatus;
    }).sort((a,b)=>a.order-b.order);
  }, [tenderData, searchQuery, statusFilter, requirementStatuses, language]);

  const handleGenerate = async () => {
    if (!tenderData) return;
    setGenerating(true);
    setGenError(null);
    setGeneratedPdfUrl(null);
    try {
      const { tender } = tenderData;
      const okItems = [];
      for (const req of tenderData.requirements) {
        const st = requirementStatuses[req.id];
        if (!st || st.key !== 'ok') continue;
        const fileId = matches[req.id];
        const meta = pdfMeta.find(f => f.id === fileId);
        if (!meta) continue;
        okItems.push({ req, meta });
      }

      const finalPdf = await PDFDocument.create();
      const fontRegular = await finalPdf.embedFont(StandardFonts.Helvetica);
      const fontBold = await finalPdf.embedFont(StandardFonts.HelveticaBold);

      const pageWidth = 595.28;
      const pageHeight = 841.89;
      const margin = 50;

      let logoImage = null;
      try {
        const logoRes = await fetch('./company_logo.png');
        if (logoRes.ok) {
          const logoBytes = await logoRes.arrayBuffer();
          try { logoImage = await finalPdf.embedPng(logoBytes); }
          catch { try { logoImage = await finalPdf.embedJpg(logoBytes); } catch {} }
        }
      } catch {}

      const cover = finalPdf.addPage([pageWidth, pageHeight]);
      let coverY = pageHeight - margin;

      if (logoImage) {
        const dim = logoImage.scale(0.35);
        cover.drawImage(logoImage, { x: (pageWidth - dim.width)/2, y: coverY - dim.height, width: dim.width, height: dim.height });
        coverY -= dim.height + 24;
      }

      cover.drawText(sanitizeForPdf('Tender Submission Package'), {
        x: margin, y: coverY, size: 20, font: fontBold, color: rgb(0.07,0.29,0.37)
      });
      coverY -= 28;
      cover.drawText(sanitizeForPdf('Tender Package'), {
        x: margin, y: coverY, size: 12, font: fontRegular, color: rgb(0.4,0.4,0.4)
      });
      coverY -= 30;
      cover.drawLine({ start: {x:margin,y:coverY}, end:{x:pageWidth-margin,y:coverY}, thickness:1, color: rgb(0.8,0.8,0.8) });
      coverY -= 30;

      const t = (en,bn) => language==='bn'?bn:en;

      const addField = (label, value) => {
        if (coverY < 100) {
          // not handling multi-page cover for simplicity
        }
        cover.drawText(sanitizeForPdf(label+':'), { x: margin, y: coverY, size: 10, font: fontBold, color: rgb(0.3,0.3,0.3) });
        coverY -= 14;
        const val = sanitizeForPdf(value || 'N/A');
        cover.drawText(val.slice(0,90), { x: margin, y: coverY, size: 12, font: fontRegular, color: rgb(0.1,0.1,0.1) });
        coverY -= 22;
      };

      addField(t('Tender ID','দরপত্র আইডি'), tender.tender_id);
      addField(t('Title','শিরোনাম'), tender.title);
      addField(t('Procuring Entity','ক্রয়কারী প্রতিষ্ঠান'), tender.procuring_entity);
      addField(t('Bidder','নিবেদনকারী'), tender.bidder);
      addField(t('Submission Deadline','জমার শেষ তারিখ'), tender.submission_deadline || '2026-10-20');
      addField(t('Total Documents','মোট নথি'), String(okItems.length));

      coverY -= 20;
      cover.drawText(sanitizeForPdf(t('Included Documents:','অন্তর্ভুক্ত নথি:')), {
        x: margin, y: coverY, size: 11, font: fontBold, color: rgb(0.2,0.2,0.2)
      });
      coverY -= 18;
      okItems.forEach((item,i)=>{
        const title = language==='bn'?item.req.title_bn:item.req.title_en;
        cover.drawText(sanitizeForPdf(`${i+1}. ${item.req.id} - ${title}`), {
          x: margin+10, y: coverY, size: 9, font: fontRegular, color: rgb(0.2,0.2,0.2)
        });
        coverY -= 13;
      });

      for (const { req, meta } of okItems) {
        try {
          const buf = await meta.file.arrayBuffer();
          const srcPdf = await PDFDocument.load(buf);
          const copied = await finalPdf.copyPages(srcPdf, srcPdf.getPageIndices());
          copied.forEach(p => finalPdf.addPage(p));
        } catch (e) {
          console.error('Failed to merge', meta.name, e);
        }
      }

      const pdfBytes = await finalPdf.save();
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      setGeneratedPdfUrl(url);
    } catch (e) {
      console.error(e);
      setGenError(e.message || 'Generation failed');
    } finally {
      setGenerating(false);
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  const readyCount = Object.values(requirementStatuses).filter(s=>s.key==='ok').length;
  const mandatoryMissing = tenderData.requirements.filter(r=>r.mandatory && requirementStatuses[r.id]?.key!=='ok').length;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="bg-white border-b sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <MTLogo />
            <div>
              <h1 className="font-bold text-[#0f4a5e] leading-tight">MD. RAKIBUL HASAN</h1>
              <p className="text-xs text-gray-500">Tender Package Builder • MT</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={()=>setLanguage(language==='en'?'bn':'en')} className="px-3 py-1.5 rounded-full bg-gray-100 text-sm font-medium hover:bg-gray-200">
              {language==='en'?'বাংলা':'English'}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-xl shadow-sm border p-5">
            <h2 className="font-bold text-lg mb-2">{language==='bn'?'দরপত্র তথ্য':'Tender Info'}</h2>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-gray-500">ID:</span> <span className="font-medium">{tenderData.tender.tender_id}</span></div>
              <div><span className="text-gray-500">Deadline:</span> <span className="font-medium">{tenderData.tender.submission_deadline}</span></div>
              <div className="col-span-2"><span className="text-gray-500">Title:</span> <span className="font-medium">{tenderData.tender.title}</span></div>
              <div className="col-span-2"><span className="text-gray-500">Entity:</span> <span className="font-medium">{tenderData.tender.procuring_entity}</span></div>
            </div>
            <div className="mt-4 flex gap-2 text-xs">
              <span className="px-2 py-1 bg-green-50 text-green-700 rounded-full border">{readyCount} Ready</span>
              {mandatoryMissing>0 && <span className="px-2 py-1 bg-red-50 text-red-700 rounded-full border">{mandatoryMissing} Mandatory Missing</span>}
              <span className="px-2 py-1 bg-gray-50 text-gray-700 rounded-full border">{pdfMeta.length} PDFs Uploaded</span>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border p-5">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-bold text-lg">{language==='bn'?'নথি আপলোড':'Upload Documents'}</h2>
              <button onClick={()=>fileInputRef.current?.click()} className="text-sm px-3 py-1.5 bg-[#0f4a5e] text-white rounded-lg hover:bg-[#124e64]">Browse</button>
            </div>
            <input ref={fileInputRef} type="file" multiple accept=".pdf" hidden onChange={(e)=>handleFiles(e.target.files)} />
            <div
              onDragOver={(e)=>{e.preventDefault(); setIsDragging(true);}}
              onDragLeave={()=>setIsDragging(false)}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-xl p-8 text-center transition ${isDragging?'border-[#0f4a5e] bg-blue-50':'border-gray-300 bg-gray-50'}`}
            >
              <p className="font-medium">Drag & drop PDFs here</p>
              <p className="text-xs text-gray-500 mt-1">Max {MAX_FILES} files, total 50MB</p>
            </div>
            {uploadError && <p className="text-sm text-red-600 mt-2">{uploadError}</p>}

            {pdfMeta.length>0 && (
              <div className="mt-4 space-y-2">
                {pdfMeta.map(f=>(
                  <div key={f.id} className="flex items-center justify-between bg-gray-50 border rounded-lg px-3 py-2 text-sm">
                    <div className="truncate"><span className="font-medium truncate">{f.name}</span> <span className="text-xs text-gray-500">({formatBytes(f.size)})</span></div>
                    <button onClick={()=>removeFile(f.id)} className="text-red-600 hover:text-red-700 text-xs ml-2">Remove</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-sm border p-5">
            <div className="flex flex-wrap gap-2 mb-4">
              <input value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} placeholder={language==='bn'?'খুঁজুন...':'Search...'} className="flex-1 min-w-[160px] border rounded-lg px-3 py-1.5 text-sm" />
              <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} className="border rounded-lg px-2 py-1.5 text-sm">
                <option value="all">All</option>
                <option value="ok">Ready</option>
                <option value="missing">Missing</option>
                <option value="expired">Expired</option>
              </select>
            </div>
            <div className="space-y-3">
              {filteredReqs.map(req=>{
                const status = requirementStatuses[req.id];
                const title = language==='bn'?req.title_bn:req.title_en;
                const matchedFile = matches[req.id] ? pdfMeta.find(f=>f.id===matches[req.id]) : null;
                return (
                  <div key={req.id} className="border rounded-lg p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono bg-gray-100 px-1.5 py-0.5 rounded">{req.id}</span>
                        {req.mandatory && <span className="text-[10px] px-1.5 py-0.5 bg-red-50 text-red-600 border border-red-200 rounded-full">Required</span>}
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${status.key==='ok'?'bg-green-50 text-green-700 border-green-200':status.key==='missing'?'bg-red-50 text-red-700 border-red-200':status.key==='expired'?'bg-orange-50 text-orange-700 border-orange-200':'bg-gray-50 text-gray-600'}`}>{status.label}</span>
                      </div>
                      <p className="font-medium text-sm mt-1">{title}</p>
                      {req.has_expiry && (
                        <input type="date" value={expiries[req.id]||''} onChange={e=>setExpiries(prev=>({...prev,[req.id]:e.target.value}))} className="mt-1 border rounded px-2 py-1 text-xs" />
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <select value={matches[req.id]||''} onChange={e=>setMatches(prev=>({...prev,[req.id]:e.target.value||undefined}))} className="border rounded-lg px-2 py-1.5 text-xs min-w-[140px]">
                        <option value="">{language==='bn'?'ফাইল নির্বাচন':'Select file'}</option>
                        {pdfMeta.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-xl shadow-sm border p-5 sticky top-[80px]">
            <h3 className="font-bold mb-3">{language==='bn'?'প্যাকেজ তৈরি':'Generate Package'}</h3>
            <p className="text-xs text-gray-500 mb-4">{language==='bn'?`প্রস্তুত: ${readyCount} / ${tenderData.requirements.length}`:`Ready: ${readyCount} / ${tenderData.requirements.length}`}</p>
            <button onClick={handleGenerate} disabled={generating || readyCount===0} className="w-full py-2.5 rounded-lg bg-[#0f4a5e] text-white font-medium hover:bg-[#134b60] disabled:bg-gray-300 disabled:cursor-not-allowed">
              {generating ? (language==='bn'?'তৈরি হচ্ছে...':'Generating...') : (language==='bn'?'PDF তৈরি করুন':'Generate Final PDF')}
            </button>
            {genError && <p className="text-xs text-red-600 mt-2">{genError}</p>}
            {generatedPdfUrl && (
              <div className="mt-4 p-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm text-green-800 font-medium mb-2">✅ Package Ready!</p>
                <a href={generatedPdfUrl} download={`Tender_${tenderData.tender.tender_id}_Package.pdf`} className="block text-center w-full py-2 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700">Download PDF</a>
                <button onClick={()=>{ if(generatedPdfUrl) window.open(generatedPdfUrl,'_blank'); }} className="mt-2 w-full py-2 bg-white border border-green-300 text-green-700 rounded-lg text-sm">Preview</button>
              </div>
            )}
            <div className="mt-6 text-[11px] text-gray-400">
              <p>MT • Meghna Tech Tender Builder</p>
              <p>Built for GitHub Pages</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
