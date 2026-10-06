import React, { useState, useEffect, useMemo } from 'react';

// MT Logo component - tries to load company_logo.png, falls back to a simple circle
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

// Main App component
function App() {
  // Language state - initialize from localStorage or default to 'en'
  const [language, setLanguage] = useState(() => {
    const saved = localStorage.getItem('app_language');
    return saved === 'bn' ? 'bn' : 'en';
  });

  // Tender data state
  const [tenderData, setTenderData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Persist language choice to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('app_language', language);
  }, [language]);

  // Load requirements.json on mount
  useEffect(() => {
    const loadData = async () => {
      try {
        setLoading(true);
        const response = await fetch('/requirements.json');
        if (!response.ok) {
          throw new Error(`Failed to load requirements.json: ${response.status}`);
        }
        const data = await response.json();

        // Validate basic structure
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

  // Toggle language between 'en' and 'bn'
  const toggleLanguage = () => {
    setLanguage((prev) => (prev === 'en' ? 'bn' : 'en'));
  };

  // Sorted requirements by order (ascending)
  const sortedRequirements = useMemo(() => {
    if (!tenderData?.requirements) return [];
    return [...tenderData.requirements].sort((a, b) => (a.order || 0) - (b.order || 0));
  }, [tenderData]);

  // Helper to get title based on current language
  const getTitle = (item) => {
    if (language === 'bn') {
      return item.title_bn || item.title_en || '—';
    }
    return item.title_en || item.title_bn || '—';
  };

  // Format date for display
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

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-2xl text-gray-600 font-medium">Loading...</div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-xl shadow-lg p-8 max-w-md text-center">
          <div className="text-red-500 text-5xl mb-4">⚠️</div>
          <h1 className="text-2xl font-bold text-gray-800 mb-2">Error Loading Data</h1>
          <p className="text-gray-600">{error}</p>
          <p className="text-sm text-gray-400 mt-4">
            Make sure <code className="bg-gray-100 px-1 rounded">requirements.json</code> is in the{' '}
            <code className="bg-gray-100 px-1 rounded">public</code> folder.
          </p>
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

          {/* Language Toggle */}
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
        {/* Tender Details Card */}
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
              {sortedRequirements.length}{' '}
              {language === 'bn' ? 'টি' : 'items'}
            </span>
          </div>

          {sortedRequirements.length === 0 ? (
            <div className="bg-white rounded-xl shadow-md p-8 text-center text-gray-500 text-lg">
              {language === 'bn' ? 'কোনো শর্ত পাওয়া যায়নি' : 'No requirements found'}
            </div>
          ) : (
            <div className="space-y-4">
              {sortedRequirements.map((req) => (
                <div
                  key={req.id}
                  className="bg-white rounded-xl shadow-md p-5 hover:shadow-lg transition-shadow border-l-4 border-transparent hover:border-blue-400"
                >
                  <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                    {/* Order Badge */}
                    <div className="flex-shrink-0">
                      <div className="w-10 h-10 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-lg">
                        {req.order}
                      </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <h4 className="text-xl font-semibold text-gray-900 mb-3">
                        {getTitle(req)}
                      </h4>

                      <div className="flex flex-wrap gap-2">
                        {/* Mandatory Badge */}
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

                        {/* Expiry Badge */}
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
                      </div>
                    </div>

                    {/* ID */}
                    <div className="flex-shrink-0 self-start">
                      <span className="text-xs text-gray-400 font-mono bg-gray-50 px-2 py-1 rounded">
                        {req.id}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* Footer */}
      <footer className="max-w-5xl mx-auto px-4 py-6 text-center text-sm text-gray-400">
        {language === 'bn'
          ? '© ২০২৬ এমটি টেন্ডার পোর্টাল। সর্বস্বত্ব সংরক্ষিত।'
          : '© 2026 MT Tender Portal. All rights reserved.'}
      </footer>
    </div>
  );
}

export default App;