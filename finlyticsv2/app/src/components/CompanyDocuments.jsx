import React, { useState, useEffect } from 'react';
import { getCompanyDocuments, uploadDocument, deleteDocument, downloadDocument, downloadDocumentPdf, getCompanySettings, updateCompanySettings } from '../services/apiService';
import Toast from './Toast';
import { useToast } from '../hooks/useToast';

const CompanyDocuments = () => {
  const { toast, showToast, clearToast } = useToast();
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [activeTab, setActiveTab] = useState('upload'); // Upload tab as default
  const [filterType, setFilterType] = useState('All');
  const [searchTerm, setSearchTerm] = useState('');
  const [companySettings, setCompanySettings] = useState(null);
  
  // Form metadata
  const [documentType, setDocumentType] = useState('Other');
  const [personName, setPersonName] = useState('');
  const [personTitle, setPersonTitle] = useState('');
  const [isActive, setIsActive] = useState(false);
  const [relatedEntity, setRelatedEntity] = useState('');
  const [documentDate, setDocumentDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [notes, setNotes] = useState('');
  
  // Edit state
  const [editingDoc, setEditingDoc] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);

  // File details modal state
  const [detailsDoc, setDetailsDoc] = useState(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [settingLogo, setSettingLogo] = useState('');

  const documentTypes = [
    'Company Logo',
    'Company Registration',
    'Articles of Association',
    'Share Certificate',
    'Meeting Minutes',
    'Director Signature',
    'Officer Signature',
    'Tax Return',
    'VAT Return',
    'PAYE/RTI',
    'Pension',
    'Insurance',
    'Financial Statement',
    'Banking',
    'Contract',
    'Policy',
    'Legal Document',
    'Template',
    'Correspondence',
    'Other'
  ];

  useEffect(() => {
    loadDocuments();
    loadCompanySettings();
  }, []);
  const loadCompanySettings = async () => {
    try {
      const settings = await getCompanySettings();
      setCompanySettings(settings);
    } catch (error) {
      console.error('Error loading company settings:', error);
    }
  };


  const loadDocuments = async () => {
    setLoading(true);
    try {
      const data = await getCompanyDocuments();
      console.log('Documents loaded:', data);
      if (data && data.length > 0) {
        console.log('First document sample:', data[0]);
      }
      setDocuments(data);
    } catch (error) {
      console.error('Error loading documents:', error);
      showToast('Failed to load documents', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = (event) => {
    const file = event.target.files[0];
    setSelectedFile(file);
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      showToast('Please select a file to upload', 'error');
      return;
    }

    setUploading(true);
    try {
      const metadata = {
        documentType,
        personName: personName || undefined,
        personTitle: personTitle || undefined,
        isActive,
        relatedEntity: relatedEntity || undefined,
        documentDate: documentDate || undefined,
        expiryDate: expiryDate || undefined,
        notes: notes || undefined
      };

      const uploadedDoc = await uploadDocument(selectedFile, metadata);

      if (documentType === 'Company Logo' && uploadedDoc?.url && companySettings) {
        try {
          await updateCompanySettings({
            ...companySettings,
            logoUrl: uploadedDoc.url
          });
          setCompanySettings({
            ...companySettings,
            logoUrl: uploadedDoc.url
          });
        } catch (logoError) {
          console.error('Error updating company logo URL:', logoError);
        }
      }
      showToast('Document uploaded successfully');
      
      // Reset form
      setSelectedFile(null);
      setDocumentType('Other');
      setPersonName('');
      setPersonTitle('');
      setIsActive(false);
      setRelatedEntity('');
      setDocumentDate('');
      setExpiryDate('');
      setNotes('');
      document.getElementById('fileInput').value = '';
      
      await loadDocuments();
    } catch (error) {
      console.error('Error uploading document:', error);
      showToast('Failed to upload document: ' + error.message, 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (doc) => {
    try {
      console.log('Download clicked for doc:', doc);
      console.log('Using blobName:', doc.blobName);
      
      const blob = await downloadDocument(doc.blobName);
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = doc.fileName || doc.name;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(blobUrl);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Error downloading document:', error);
      showToast('Failed to download document: ' + error.message, 'error');
    }
  };

  const handleView = async (doc) => {
    try {
      console.log('View clicked for doc:', doc);
      console.log('Using blobName:', doc.blobName);
      
      const isTemplate = doc.documentType === 'Template' || (doc.fileName || '').toLowerCase().endsWith('.html');
      const blob = isTemplate ? await downloadDocumentPdf(doc.blobName) : await downloadDocument(doc.blobName);
      const baseName = doc.fileName || doc.name || 'document';
      const fileName = isTemplate ? baseName.replace(/\.html?$/i, '.pdf') : baseName;
      const file = new File([blob], fileName, { type: blob.type || (isTemplate ? 'application/pdf' : 'application/octet-stream') });
      const blobUrl = window.URL.createObjectURL(file);
      window.open(blobUrl, '_blank', 'noopener');
      // Clean up after a delay to allow the browser to open it
      setTimeout(() => window.URL.revokeObjectURL(blobUrl), 1000);
    } catch (error) {
      console.error('Error viewing document:', error);
      showToast('Failed to view document: ' + error.message, 'error');
    }
  };

  const handleDelete = async (doc) => {
    if (!confirm(`Are you sure you want to delete ${doc.fileName || doc.name}?`)) {
      return;
    }

    console.log('Delete clicked for doc:', doc);
    console.log('Using blobName:', doc.blobName);

    try {
      setLoading(true);
      await deleteDocument(doc.blobName || doc.url);
      showToast('Document deleted successfully');
      await loadDocuments();
    } catch (error) {
      console.error('Error deleting document:', error);
      showToast('Failed to delete document: ' + error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (doc) => {
    setEditingDoc({...doc});
    setShowEditModal(true);
  };

  const isImageFile = (doc) => {
    const fileName = (doc.fileName || doc.name || '').toLowerCase();
    const contentType = (doc.contentType || '').toLowerCase();
    return /\.(jpg|jpeg|png|gif|svg|webp|bmp)$/.test(fileName)
      || contentType.startsWith('image/');
  };

  const handleSetAsLogo = async (doc, logoType) => {
    if (!doc.url || !companySettings) return;
    setSettingLogo(logoType);
    try {
      const updated = { ...companySettings };
      if (logoType === 'email') {
        updated.emailLogoUrl = doc.url;
      } else if (logoType === 'document') {
        updated.documentLogoUrl = doc.url;
      }
      await updateCompanySettings(updated);
      setCompanySettings(updated);
      showToast(`${logoType === 'email' ? 'Email' : 'Document'} logo updated successfully!`);
    } catch (error) {
      console.error('Error setting logo:', error);
      showToast('Failed to update logo: ' + error.message, 'error');
    } finally {
      setSettingLogo('');
    }
  };

  const handleSaveEdit = async () => {
    try {
      const response = await fetch(`https://finlyticsdevfunc.azurewebsites.net/api/companydocuments/update?blobName=${encodeURIComponent(editingDoc.blobName)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          documentType: editingDoc.documentType,
          personName: editingDoc.personName,
          personTitle: editingDoc.personTitle,
          isActive: editingDoc.isActive,
          relatedEntity: editingDoc.relatedEntity,
          documentDate: editingDoc.documentDate,
          expiryDate: editingDoc.expiryDate,
          notes: editingDoc.notes
        })
      });

      if (!response.ok) {
        throw new Error('Failed to update document');
      }

      showToast('Document updated successfully');
      setShowEditModal(false);
      await loadDocuments();
    } catch (error) {
      console.error('Error updating document:', error);
      showToast('Failed to update document: ' + error.message, 'error');
    }
  };

  const getFileIcon = (fileName) => {
    if (!fileName) return '📎';
    const ext = fileName.split('.').pop().toLowerCase();
    switch (ext) {
      case 'pdf': return '📄';
      case 'doc':
      case 'docx': return '📝';
      case 'xls':
      case 'xlsx': return '📊';
      case 'jpg':
      case 'jpeg':
      case 'png': return '🖼️';
      default: return '📎';
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const formatDate = (dateString) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric'
    });
  };

  // Tab-based filtering
  const getDocumentsByTab = () => {
    let tabFiltered = documents;
    
    switch (activeTab) {
      case 'registration':
        tabFiltered = documents.filter(doc => 
          ['Company Registration', 'Articles of Association', 'Company Logo'].includes(doc.documentType)
        );
        break;
      case 'financials':
        tabFiltered = documents.filter(doc => 
          ['Tax Return', 'VAT Return', 'PAYE/RTI', 'Financial Statement', 'Banking'].includes(doc.documentType)
        );
        break;
      case 'certificates':
        tabFiltered = documents.filter(doc => 
          doc.documentType === 'Share Certificate'
        );
        break;
      case 'invoices':
        tabFiltered = documents.filter(doc => 
          doc.documentType === 'Invoice PDF'
        );
        break;
      case 'quotes':
        tabFiltered = documents.filter(doc => 
          doc.documentType === 'Quote PDF'
        );
        break;
      case 'templates':
        tabFiltered = documents.filter(doc => 
          doc.documentType === 'Template'
        );
        break;
      case 'all':
      default:
        tabFiltered = documents;
    }
    
    return tabFiltered;
  };

  const filteredDocuments = getDocumentsByTab()
    .filter(doc => filterType === 'All' || doc.documentType === filterType)
    .filter(doc => {
      if (!searchTerm) return true;
      const haystack = [
        doc.name,
        doc.documentType,
        doc.personName,
        doc.personTitle,
        doc.relatedEntity,
        doc.notes
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(searchTerm.toLowerCase());
    });

  // Show metadata fields based on document type
  const showPersonFields = ['Director Signature', 'Officer Signature'].includes(documentType);
  const showRelatedEntity = ['Share Certificate', 'Template', 'Contract', 'Legal Document'].includes(documentType);
  const showActiveCheckbox = ['Company Logo', 'Director Signature', 'Officer Signature'].includes(documentType);
  const showDates = ['Share Certificate', 'Insurance', 'Contract', 'Policy', 'Legal Document'].includes(documentType);

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <div className="loading-text">Loading Documents...</div>
      </div>
    );
  }

  return (
    <div>
      <Toast toast={toast} onClose={clearToast} />
      <h2>📁 Documents</h2>

      {/* Tab Navigation */}
      <div style={{
        display: 'flex',
        gap: '5px',
        marginBottom: '20px',
        borderBottom: '2px solid #dee2e6'
      }}>
        {[
          { id: 'upload', label: '⬆️ Upload', icon: '⬆️' },
          { id: 'all', label: '📋 All Documents', icon: '📋' },
          { id: 'registration', label: '🏛️ Statutory Documents', icon: '🏛️' },
          { id: 'certificates', label: '🏷️ Certificates', icon: '🏷️' },
          { id: 'financials', label: '💰 Financials', icon: '💰' },
          { id: 'invoices', label: '📄 Invoices', icon: '📄' },
          { id: 'quotes', label: '📝 Quotes', icon: '📝' },
          { id: 'templates', label: '🧩 Templates', icon: '🧩' }
        ].map(tab => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id);
              setFilterType('All');
              setSearchTerm('');
            }}
            style={{
              padding: '10px 20px',
              border: 'none',
              borderBottom: activeTab === tab.id ? '3px solid #007bff' : '3px solid transparent',
              background: activeTab === tab.id ? '#e7f3ff' : 'transparent',
              color: activeTab === tab.id ? '#007bff' : '#6c757d',
              cursor: 'pointer',
              fontWeight: activeTab === tab.id ? 'bold' : 'normal',
              fontSize: '14px',
              transition: 'all 0.2s'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      
      {/* Upload Section - Only visible on Upload tab */}
      {activeTab === 'upload' && (
      <div style={{
        background: '#f8f9fa',
        padding: '20px',
        borderRadius: '8px',
        marginBottom: '30px',
        border: '2px dashed #dee2e6'
      }}>
        <h3 style={{ marginTop: 0 }}>Upload Document</h3>
        
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '15px' }}>
          {/* File Input */}
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
              Select File *
            </label>
        <div className="documents-toolbar">
          <div className="filter-group">
            <label>Filter by type</label>
            <select value={filterType} onChange={(e) => setFilterType(e.target.value)}>
              <option value="All">All</option>
              {documentTypes.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>
          <div className="filter-group">
            <label>Search</label>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search name, type, person, notes..."
            />
          </div>
        </div>
            <input
              id="fileInput"
              type="file"
              onChange={handleFileSelect}
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #ced4da',
                borderRadius: '4px',
                backgroundColor: 'white'
              }}
            />
          </div>
          
          {/* Document Type */}
          <div>
            <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
              Document Type *
            </label>
            <select
              value={documentType}
              onChange={(e) => setDocumentType(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #ced4da',
                borderRadius: '4px'
              }}
            >
              {documentTypes.map(type => (
                <option key={type} value={type}>{type}</option>
              ))}
            </select>
          </div>

          {/* Person Name (for signatures) */}
          {showPersonFields && (
            <div>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                Person Name
              </label>
              <input
                type="text"
                value={personName}
                onChange={(e) => setPersonName(e.target.value)}
                placeholder="e.g., Andy Kemp"
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ced4da',
                  borderRadius: '4px'
                }}
              />
            </div>
          )}

          {/* Person Title (for signatures) */}
          {showPersonFields && (
            <div>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                Person Title
              </label>
              <input
                type="text"
                value={personTitle}
                onChange={(e) => setPersonTitle(e.target.value)}
                placeholder="e.g., Director"
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ced4da',
                  borderRadius: '4px'
                }}
              />
            </div>
          )}

          {/* Related Entity (for certificates, invoices) / Template Type (for templates) */}
          {showRelatedEntity && (
            <div>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                {documentType === 'Template' ? 'Template Type' : 'Related To'}
              </label>
              {documentType === 'Template' ? (
                <select
                  value={relatedEntity}
                  onChange={(e) => setRelatedEntity(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '8px',
                    border: '1px solid #ced4da',
                    borderRadius: '4px'
                  }}
                >
                  <option value="">Select Template Type...</option>
                  <option value="Share Certificate - A Ordinary Shares">Share Certificate - A Ordinary Shares</option>
                  <option value="Share Certificate - B Ordinary Shares">Share Certificate - B Ordinary Shares</option>
                  <option value="Board Minutes - Dividend Declaration">Board Minutes - Dividend Declaration</option>
                  <option value="Dividend Voucher - Shareholder">Dividend Voucher - Shareholder</option>
                </select>
              ) : (
                <input
                  type="text"
                  value={relatedEntity}
                  onChange={(e) => setRelatedEntity(e.target.value)}
                  placeholder="e.g., CERT-001, INV-123"
                  style={{
                    width: '100%',
                    padding: '8px',
                    border: '1px solid #ced4da',
                    borderRadius: '4px'
                  }}
                />
              )}
            </div>
          )}

          {/* Document Date - Only for certain document types */}
          {showDates && (
          <div>
            <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
              Document Date
            </label>
            <input
              type="date"
              value={documentDate}
              onChange={(e) => setDocumentDate(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #ced4da',
                borderRadius: '4px'
              }}
            />
          </div>
          )}

          {/* Expiry Date - Only for certain document types */}
          {showDates && (
          <div>
            <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
              Expiry Date
            </label>
            <input
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #ced4da',
                borderRadius: '4px'
              }}
            />
          </div>
          )}

          {/* Is Active (for logos/signatures) - Only for specific types */}
          {showActiveCheckbox && (
          <div style={{ display: 'flex', alignItems: 'center', paddingTop: '24px' }}>
            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                style={{ marginRight: '8px', width: '18px', height: '18px', cursor: 'pointer' }}
              />
              <span style={{ fontWeight: 'bold' }}>Mark as Active</span>
            </label>
          </div>
          )}

          {/* Notes */}
          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows="2"
              placeholder="Additional information..."
              style={{
                width: '100%',
                padding: '8px',
                border: '1px solid #ced4da',
                borderRadius: '4px',
                resize: 'vertical'
              }}
            />
          </div>
        </div>

        <div style={{ marginTop: '15px', display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button
            onClick={handleUpload}
            disabled={!selectedFile || uploading}
            style={{
              padding: '10px 24px',
              backgroundColor: uploading ? '#6c757d' : '#28a745',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: uploading ? 'not-allowed' : 'pointer',
              fontWeight: 'bold',
              fontSize: '14px'
            }}
          >
            {uploading ? 'Uploading...' : '⬆️ Upload Document'}
          </button>
          
          {selectedFile && (
            <div style={{ color: '#495057' }}>
              <strong>{selectedFile.name}</strong> ({formatFileSize(selectedFile.size || 0)})
            </div>
          )}
        </div>
      </div>
      )}

      {/* Filter and Documents List - Hidden on Upload tab */}
      {activeTab !== 'upload' && (
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <h3 style={{ margin: 0 }}>Documents ({filteredDocuments.length})</h3>
        </div>
        
        {filteredDocuments.length === 0 ? (
          <div style={{
            padding: '40px',
            textAlign: 'center',
            color: '#6c757d',
            background: '#f8f9fa',
            borderRadius: '8px'
          }}>
            <div style={{ fontSize: '48px', marginBottom: '10px' }}>📁</div>
            <div>No documents {filterType !== 'All' ? `of type "${filterType}"` : 'uploaded yet'}</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: '#f8f9fa', borderBottom: '2px solid #dee2e6' }}>
                  <th style={{ padding: '12px', textAlign: 'left' }}>File</th>
                  <th style={{ padding: '12px', textAlign: 'left' }}>Type</th>
                  <th style={{ padding: '12px', textAlign: 'left' }}>Person/Entity</th>
                  <th style={{ padding: '12px', textAlign: 'center' }}>Active</th>
                  <th style={{ padding: '12px', textAlign: 'left' }}>Date</th>
                  <th style={{ padding: '12px', textAlign: 'left' }}>Size</th>
                  <th style={{ padding: '12px', textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredDocuments.map((doc, index) => (
                  <tr
                    key={index}
                    style={{
                      borderBottom: '1px solid #dee2e6',
                      backgroundColor: index % 2 === 0 ? 'white' : '#f8f9fa',
                      cursor: 'pointer',
                      transition: 'background-color 0.15s'
                    }}
                    onClick={() => { setDetailsDoc(doc); setShowDetailsModal(true); }}
                    onMouseEnter={e => e.currentTarget.style.backgroundColor = '#e7f3ff'}
                    onMouseLeave={e => e.currentTarget.style.backgroundColor = index % 2 === 0 ? 'white' : '#f8f9fa'}
                  >
                    <td style={{ padding: '12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '20px' }}>{getFileIcon(doc.fileName || doc.name || 'unknown')}</span>
                        <strong>{doc.fileName || doc.name || 'Unknown'}</strong>
                      </div>
                    </td>
                    <td style={{ padding: '12px' }}>
                      <span style={{
                        padding: '4px 8px',
                        backgroundColor: '#e7f3ff',
                        borderRadius: '4px',
                        fontSize: '11px',
                        fontWeight: 'bold',
                        color: '#0066cc'
                      }}>
                        {doc.documentType || 'Other'}
                      </span>
                    </td>
                    <td style={{ padding: '12px', fontSize: '13px' }}>
                      {doc.personName && (
                        <div><strong>{doc.personName}</strong> {doc.personTitle && `(${doc.personTitle})`}</div>
                      )}
                      {doc.relatedEntity && (
                        <div style={{ color: '#666' }}>{doc.relatedEntity}</div>
                      )}
                      {!doc.personName && !doc.relatedEntity && '-'}
                    </td>
                    <td style={{ padding: '12px', textAlign: 'center' }}>
                      {doc.isActive ? <span style={{ color: '#28a745', fontSize: '18px' }}>✓</span> : '-'}
                    </td>
                    <td style={{ padding: '12px', fontSize: '13px' }}>{formatDate(doc.documentDate)}</td>
                    <td style={{ padding: '12px' }}>{formatFileSize(doc.sizeInBytes || doc.size || 0)}</td>
                    <td style={{ padding: '12px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => handleView(doc)}
                        title="View"
                        style={{
                          padding: '6px 10px',
                          backgroundColor: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: '20px'
                        }}
                      >
                        👁️
                      </button>
                      <button
                        onClick={() => handleDownload(doc)}
                        title="Download"
                        style={{
                          padding: '6px 10px',
                          backgroundColor: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: '20px'
                        }}
                      >
                        ⬇️
                      </button>
                      <button
                        onClick={() => handleEdit(doc)}
                        title="Edit"
                        style={{
                          padding: '6px 10px',
                          backgroundColor: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: '20px'
                        }}
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => handleDelete(doc)}
                        title="Delete"
                        style={{
                          padding: '6px 10px',
                          backgroundColor: 'transparent',
                          border: 'none',
                          cursor: 'pointer',
                          fontSize: '20px'
                        }}
                      >
                        🗑️
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      )}

      {/* File Details Modal */}
      {showDetailsModal && detailsDoc && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }} onClick={() => setShowDetailsModal(false)}>
          <div style={{
            backgroundColor: 'white',
            padding: '30px',
            borderRadius: '12px',
            maxWidth: '600px',
            width: '90%',
            maxHeight: '85vh',
            overflowY: 'auto',
            boxShadow: '0 20px 60px rgba(0,0,0,0.3)'
          }} onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
              <div>
                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '24px' }}>{getFileIcon(detailsDoc.fileName || detailsDoc.name || 'unknown')}</span>
                  {detailsDoc.fileName || detailsDoc.name || 'Unknown'}
                </h3>
                <span style={{
                  display: 'inline-block',
                  marginTop: '6px',
                  padding: '3px 10px',
                  backgroundColor: '#e7f3ff',
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: 'bold',
                  color: '#0066cc'
                }}>
                  {detailsDoc.documentType || 'Other'}
                </span>
              </div>
              <button
                onClick={() => setShowDetailsModal(false)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: '22px',
                  cursor: 'pointer',
                  color: '#6c757d',
                  padding: '0 4px'
                }}
              >✖</button>
            </div>

            {/* Image Preview */}
            {isImageFile(detailsDoc) && detailsDoc.url && (
              <div style={{
                marginBottom: '20px',
                padding: '16px',
                background: '#f8f9fa',
                borderRadius: '8px',
                textAlign: 'center'
              }}>
                <img
                  src={detailsDoc.url}
                  alt={detailsDoc.fileName || 'Preview'}
                  style={{
                    maxWidth: '100%',
                    maxHeight: '200px',
                    borderRadius: '6px',
                    objectFit: 'contain',
                    border: '1px solid #dee2e6'
                  }}
                />
              </div>
            )}

            {/* File Details */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '140px 1fr',
              gap: '8px 12px',
              fontSize: '14px',
              marginBottom: '20px'
            }}>
              <div style={{ fontWeight: 'bold', color: '#6c757d' }}>Size</div>
              <div>{formatFileSize(detailsDoc.sizeInBytes || detailsDoc.size || 0)}</div>

              <div style={{ fontWeight: 'bold', color: '#6c757d' }}>Uploaded</div>
              <div>{formatDate(detailsDoc.uploadDate)}</div>

              {detailsDoc.documentDate && (
                <>
                  <div style={{ fontWeight: 'bold', color: '#6c757d' }}>Document Date</div>
                  <div>{formatDate(detailsDoc.documentDate)}</div>
                </>
              )}

              {detailsDoc.expiryDate && (
                <>
                  <div style={{ fontWeight: 'bold', color: '#6c757d' }}>Expiry Date</div>
                  <div>{formatDate(detailsDoc.expiryDate)}</div>
                </>
              )}

              {detailsDoc.contentType && (
                <>
                  <div style={{ fontWeight: 'bold', color: '#6c757d' }}>Content Type</div>
                  <div>{detailsDoc.contentType}</div>
                </>
              )}

              {detailsDoc.personName && (
                <>
                  <div style={{ fontWeight: 'bold', color: '#6c757d' }}>Person</div>
                  <div>{detailsDoc.personName}{detailsDoc.personTitle ? ` (${detailsDoc.personTitle})` : ''}</div>
                </>
              )}

              {detailsDoc.relatedEntity && (
                <>
                  <div style={{ fontWeight: 'bold', color: '#6c757d' }}>Related Entity</div>
                  <div>{detailsDoc.relatedEntity}</div>
                </>
              )}

              <div style={{ fontWeight: 'bold', color: '#6c757d' }}>Active</div>
              <div>{detailsDoc.isActive ? '✅ Yes' : '— No'}</div>

              {detailsDoc.notes && (
                <>
                  <div style={{ fontWeight: 'bold', color: '#6c757d' }}>Notes</div>
                  <div>{detailsDoc.notes}</div>
                </>
              )}
            </div>

            {/* Current Logo Status (if image) */}
            {isImageFile(detailsDoc) && detailsDoc.url && companySettings && (
              <div style={{
                marginBottom: '20px',
                padding: '12px 16px',
                background: '#f0f9ff',
                borderRadius: '8px',
                border: '1px solid #bae6fd',
                fontSize: '13px'
              }}>
                <div style={{ fontWeight: 'bold', marginBottom: '6px', color: '#0369a1' }}>🔗 Current Logo Settings</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <div>
                    <strong>Email Logo:</strong>{' '}
                    {companySettings.emailLogoUrl === detailsDoc.url
                      ? <span style={{ color: '#16a34a', fontWeight: 'bold' }}>✅ Using this image</span>
                      : <span style={{ color: '#6b7280' }}>{companySettings.emailLogoUrl ? 'Set to another image' : 'Not set (using default)'}</span>
                    }
                  </div>
                  <div>
                    <strong>Document Logo:</strong>{' '}
                    {companySettings.documentLogoUrl === detailsDoc.url
                      ? <span style={{ color: '#16a34a', fontWeight: 'bold' }}>✅ Using this image</span>
                      : <span style={{ color: '#6b7280' }}>{companySettings.documentLogoUrl ? 'Set to another image' : 'Not set (using default)'}</span>
                    }
                  </div>
                </div>
              </div>
            )}

            {/* Set as Logo Buttons (image files only) */}
            {isImageFile(detailsDoc) && detailsDoc.url && (
              <div style={{
                display: 'flex',
                gap: '10px',
                marginBottom: '16px',
                flexWrap: 'wrap'
              }}>
                <button
                  onClick={() => handleSetAsLogo(detailsDoc, 'email')}
                  disabled={settingLogo !== '' || (companySettings?.emailLogoUrl === detailsDoc.url)}
                  style={{
                    flex: 1,
                    padding: '12px 16px',
                    backgroundColor: companySettings?.emailLogoUrl === detailsDoc.url ? '#e5e7eb' : '#7c3aed',
                    color: companySettings?.emailLogoUrl === detailsDoc.url ? '#9ca3af' : 'white',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: companySettings?.emailLogoUrl === detailsDoc.url ? 'default' : 'pointer',
                    fontWeight: 'bold',
                    fontSize: '14px'
                  }}
                >
                  {settingLogo === 'email' ? 'Setting…'
                    : companySettings?.emailLogoUrl === detailsDoc.url ? '✅ Email Logo (current)'
                    : '📧 Set as Email Logo'}
                </button>
                <button
                  onClick={() => handleSetAsLogo(detailsDoc, 'document')}
                  disabled={settingLogo !== '' || (companySettings?.documentLogoUrl === detailsDoc.url)}
                  style={{
                    flex: 1,
                    padding: '12px 16px',
                    backgroundColor: companySettings?.documentLogoUrl === detailsDoc.url ? '#e5e7eb' : '#2563eb',
                    color: companySettings?.documentLogoUrl === detailsDoc.url ? '#9ca3af' : 'white',
                    border: 'none',
                    borderRadius: '8px',
                    cursor: companySettings?.documentLogoUrl === detailsDoc.url ? 'default' : 'pointer',
                    fontWeight: 'bold',
                    fontSize: '14px'
                  }}
                >
                  {settingLogo === 'document' ? 'Setting…'
                    : companySettings?.documentLogoUrl === detailsDoc.url ? '✅ Document Logo (current)'
                    : '📄 Set as Document Logo'}
                </button>
              </div>
            )}

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', borderTop: '1px solid #e5e7eb', paddingTop: '16px' }}>
              <button
                onClick={() => { handleView(detailsDoc); }}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#f0f9ff',
                  color: '#0369a1',
                  border: '1px solid #bae6fd',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                👁️ View
              </button>
              <button
                onClick={() => { handleDownload(detailsDoc); }}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#f0fdf4',
                  color: '#15803d',
                  border: '1px solid #bbf7d0',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontWeight: 'bold'
                }}
              >
                ⬇️ Download
              </button>
              <button
                onClick={() => setShowDetailsModal(false)}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer'
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && editingDoc && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 1000
        }}>
          <div style={{
            backgroundColor: 'white',
            padding: '30px',
            borderRadius: '8px',
            maxWidth: '600px',
            width: '90%',
            maxHeight: '80vh',
            overflowY: 'auto'
          }}>
            <h3 style={{ marginTop: 0 }}>Edit Document: {editingDoc.fileName || editingDoc.name}</h3>
            
            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>Document Type</label>
              <select
                value={editingDoc.documentType}
                onChange={(e) => setEditingDoc({...editingDoc, documentType: e.target.value})}
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ced4da',
                  borderRadius: '4px'
                }}
              >
                {documentTypes.map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>

            {['Director Signature', 'Officer Signature'].includes(editingDoc.documentType) && (
              <>
                <div style={{ marginBottom: '15px' }}>
                  <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>Person Name</label>
                  <input
                    type="text"
                    value={editingDoc.personName || ''}
                    onChange={(e) => setEditingDoc({...editingDoc, personName: e.target.value})}
                    style={{
                      width: '100%',
                      padding: '8px',
                      border: '1px solid #ced4da',
                      borderRadius: '4px'
                    }}
                  />
                </div>
                <div style={{ marginBottom: '15px' }}>
                  <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>Person Title</label>
                  <input
                    type="text"
                    value={editingDoc.personTitle || ''}
                    onChange={(e) => setEditingDoc({...editingDoc, personTitle: e.target.value})}
                    style={{
                      width: '100%',
                      padding: '8px',
                      border: '1px solid #ced4da',
                      borderRadius: '4px'
                    }}
                  />
                </div>
              </>
            )}

            {['Share Certificate', 'Template'].includes(editingDoc.documentType) && (
              <div style={{ marginBottom: '15px' }}>
                <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>
                  {editingDoc.documentType === 'Template' ? 'Template Type' : 'Related To'}
                </label>
                {editingDoc.documentType === 'Template' ? (
                  <select
                    value={editingDoc.relatedEntity || ''}
                    onChange={(e) => setEditingDoc({...editingDoc, relatedEntity: e.target.value})}
                    style={{
                      width: '100%',
                      padding: '8px',
                      border: '1px solid #ced4da',
                      borderRadius: '4px'
                    }}
                  >
                    <option value="">Select Template Type...</option>
                    <option value="Share Certificate - A Ordinary Shares">Share Certificate - A Ordinary Shares</option>
                    <option value="Share Certificate - B Ordinary Shares">Share Certificate - B Ordinary Shares</option>
                    <option value="Board Minutes - Dividend Declaration">Board Minutes - Dividend Declaration</option>
                    <option value="Dividend Voucher - Shareholder">Dividend Voucher - Shareholder</option>
                  </select>
                ) : (
                  <input
                    type="text"
                    value={editingDoc.relatedEntity || ''}
                    onChange={(e) => setEditingDoc({...editingDoc, relatedEntity: e.target.value})}
                    placeholder="e.g., CERT-001, INV-123"
                    style={{
                      width: '100%',
                      padding: '8px',
                      border: '1px solid #ced4da',
                      borderRadius: '4px'
                    }}
                  />
                )}
              </div>
            )}

            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={editingDoc.isActive || false}
                  onChange={(e) => setEditingDoc({...editingDoc, isActive: e.target.checked})}
                  style={{ marginRight: '8px' }}
                />
                <span style={{ fontWeight: 'bold' }}>Mark as Active</span>
              </label>
            </div>

            <div style={{ marginBottom: '15px' }}>
              <label style={{ display: 'block', marginBottom: '5px', fontWeight: 'bold' }}>Notes</label>
              <textarea
                value={editingDoc.notes || ''}
                onChange={(e) => setEditingDoc({...editingDoc, notes: e.target.value})}
                rows={3}
                style={{
                  width: '100%',
                  padding: '8px',
                  border: '1px solid #ced4da',
                  borderRadius: '4px'
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowEditModal(false)}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#6c757d',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                style={{
                  padding: '10px 20px',
                  backgroundColor: '#28a745',
                  color: 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default CompanyDocuments;

