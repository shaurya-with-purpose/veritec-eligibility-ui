import { useState } from "react";
import Papa from "papaparse";
import { DataGrid } from '@mui/x-data-grid';
import { Pie } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';

ChartJS.register(ArcElement, Tooltip, Legend);

const TOKEN_KEY = "veritec_token";
const EXPIRY_KEY = "veritec_token_expiry";

const ERROR_CODE_MESSAGES = {
  '200': 'Provided purpose ID could not be found.',
  '400': 'Invalid or missing customer data.',
};

const saveTokenToCache = (token, expiresIn) => {
  localStorage.setItem(TOKEN_KEY, token);
  const expiry = Date.now() + expiresIn * 1000;
  localStorage.setItem(EXPIRY_KEY, expiry);
};

const getValidTokenFromCache = () => {
  const token = localStorage.getItem(TOKEN_KEY);
  const expiry = localStorage.getItem(EXPIRY_KEY);
  if (!token || !expiry || Date.now() > Number(expiry)) return null;
  return token;
};

const getDefaultPayload = (row) => ({
  purposeId: row["p_purpose_id"]?.trim() || row["purposeId"]?.trim() || "",
  grossIncomePerCheck: row["p_gross_pay_per_check_one"] || "0.00",
  grossMonthlyIncome: row["p_gross_monthly_income_one"] || "0.00",
  payFrequencyTypeCode: row["p_pay_freq_t"] || "BI",
  isMilitary: false,
  csoFeeAmount: "0",
  csoId: "1",
  loanAmount: row["p_requestedLoanAmount"] || "1000",
  loanTypeCode: row["p_product_type"] || "ILP"
});

function App() {
  const [token, setToken] = useState(null);
  const [payload, setPayload] = useState("");
  const [response, setResponse] = useState(null);
  const [bulkResults, setBulkResults] = useState([]);
  const [error, setError] = useState(null);
  const [csvRows, setCsvRows] = useState([]);
  const [manualPurposeId, setManualPurposeId] = useState("");
  const [manualResult, setManualResult] = useState(null);
  const [manualError, setManualError] = useState(null);
  // No row selection state needed

  const fetchToken = async () => {
    const cachedToken = getValidTokenFromCache();
    if (cachedToken) {
      setToken(cachedToken);
      setError(null);
      alert("Using cached token.");
      return;
    }

    try {
      const res = await fetch("https://api.c.pfcld.com/v1/jwt-generator-business-ms/jwt/generateToken", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          authorizationServerId: "aus6jfxvajAr0paEY5d7",
          clientId: "0oa6jfvfwmrXYEr3S5d7",
          clientSecret: "SkQS2gYGF4eMXnV_5ShwfPfvmqTw4DlpjSqPMHu4"
        })
      });

      const json = await res.json();
      const newToken = json.data.jwtToken;
      setToken(newToken);
      saveTokenToCache(newToken, json.data.expiresIn || 28800);
      setError(null);
    } catch (err) {
      console.error(err);
      setError("Token fetch failed");
    }
  };

  const handleCSVUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (results) => {
        const rows = results.data.map((row, i) => ({
          id: i + 1,
          payload: getDefaultPayload(row),
          meta: {
            firstName: row["p_Fname"] || "",
            lastName: row["p_LastName"] || "",
            phone: row["p_PhoneNumber"] || "",
            email: row["p_emailID"] || ""
          }
        }));
        setCsvRows(rows);
        setError(null);
        // Removed checkAllRows() from here
      },
      error: () => {
        setError("Invalid CSV file.");
      }
    });
  };

  const selectPayload = (payloadObj) => {
    setPayload(JSON.stringify(payloadObj, null, 2));
    setResponse(null);
    setError(null);
  };

  const checkEligibility = async () => {
    const currentToken = token || getValidTokenFromCache();
    if (!currentToken) {
      setError("No valid token. Please click Get Token.");
      return;
    }

    try {
      const parsed = JSON.parse(payload);
      const res = await fetch("https://api.c.pfcld.com/v1/veritec-business-ms/veritec/eligibility", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${currentToken}`
        },
        body: JSON.stringify(parsed)
      });

      if (!res.ok) {
        if (res.status === 401) {
          setError("Token expired. Please click 'Get Token' again.");
          setToken(null);
        } else {
          const errorText = await res.text();
          setError(`Eligibility check failed: ${res.status} ${errorText}`);
        }
        return;
      }

      const json = await res.json();
      setResponse(json);
      setError(null);
    } catch (err) {
      console.error(err);
      setError("Eligibility check failed (network or parse error)");
    }
  };

  const checkAllRows = async () => {
    setError(null);
    let currentToken = getValidTokenFromCache();
    if (!currentToken) {
      await fetchToken();
      currentToken = getValidTokenFromCache();
    }
    if (!currentToken) {
      setError("Token missing or expired. Please click 'Get Token' again.");
      return;
    }

    const results = [];

    for (let row of csvRows) {
      try {
        const res = await fetch("https://api.c.pfcld.com/v1/veritec-business-ms/veritec/eligibility", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${currentToken}`
          },
          body: JSON.stringify(row.payload)
        });

        if (res.status === 401) {
          setError("Token expired. Please click 'Get Token' again.");
          setToken(null);
          return;
        }

        const json = await res.json();
        results.push({
          rowId: row.id,
          purposeId: row.payload.purposeId,
          meta: row.meta,
          status: json?.data ? "success" : "invalid",
          response: json
        });
      } catch (err) {
        results.push({
          rowId: row.id,
          purposeId: row.payload.purposeId,
          meta: row.meta,
          status: "error",
          response: { message: "Network or server error" }
        });
      }
    }

    setBulkResults(results);
  };

  const fetchManualCustomer = async () => {
    setManualError(null);
    setManualResult(null);
    let currentToken = token || getValidTokenFromCache();
    if (!currentToken) {
      await fetchToken();
      currentToken = getValidTokenFromCache();
    }
    if (!currentToken) {
      setManualError("Token missing or expired. Please upload a CSV first.");
      return;
    }
    try {
      // Use getDefaultPayload with only purposeId, other fields default
      const payload = getDefaultPayload({ purposeId: manualPurposeId });
      const res = await fetch("https://api.c.pfcld.com/v1/veritec-business-ms/veritec/eligibility", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${currentToken}`
        },
        body: JSON.stringify(payload)
      });
      const json = await res.json();
      setManualResult(json);
    } catch (err) {
      setManualError("Failed to fetch customer info.");
    }
  };

  const getTableColumns = () => [
    { field: 'firstName', headerName: 'First Name', width: 130 },
    { field: 'lastName', headerName: 'Last Name', width: 130 },
    { field: 'purposeId', headerName: 'Purpose ID', width: 180 },
    { field: 'eligibilityCode', headerName: 'Eligibility Code', width: 100 },
    { field: 'eligibilityDescription', headerName: 'Eligibility Description', width: 250 },
    { field: 'phoneNumber', headerName: 'Phone Number', width: 110 },
    { field: 'emailId', headerName: 'Email ID', width: 250 }
  ];

  const getTableRows = () => {
    return bulkResults.map(result => {
      if (result.response?.data?.Status === "CE") {
        return {
          id: result.rowId,
          firstName: result.meta.firstName,
          lastName: result.meta.lastName,
          purposeId: result.purposeId,
          eligibilityCode: result.response.data.responsecode,
          eligibilityDescription: result.response.data.responsedescription,
          phoneNumber: result.meta.phone,
          emailId: result.meta.email
        };
      }

      // Handle error responses
      const errorStatus = result.response?.errors?.[0]?.status;
      let eligibilityCode, eligibilityDescription;

      if (ERROR_CODE_MESSAGES[errorStatus]) {
        eligibilityCode = errorStatus;
        eligibilityDescription = ERROR_CODE_MESSAGES[errorStatus];
      } else {
        eligibilityCode = errorStatus || '-101';
        eligibilityDescription =
          result.response?.errors?.[0]?.detail ||
          result.response?.errors?.[0]?.title ||
          'Error processing request';
      }

      return {
        id: result.rowId,
        firstName: result.meta.firstName,
        lastName: result.meta.lastName,
        purposeId: result.purposeId,
        eligibilityCode,
        eligibilityDescription,
        phoneNumber: result.meta.phone,
        emailId: result.meta.email
      };
    });
  };

  const exportToCSV = () => {
    const columns = getTableColumns();
    const rows = getTableRows();
    const header = columns.map(col => col.headerName);
    const data = rows.map(row =>
      columns.map(col => row[col.field] !== undefined ? row[col.field] : "")
    );
    
    const csvArray = [header, ...data];
    const csv = csvArray.map(r => r.map(field => `"${String(field).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "veritec_results.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url); // Clean up the URL object
  };

  const getDistributionData = () => {
    const distribution = {};

    bulkResults.forEach(result => {
      let code, description;

      if (result.response?.data?.Status === "CE") {
        code = result.response.data.responsecode;
        description = result.response.data.responsedescription;
      } else {
        // Group 200 and 400 errors under a common code
        const errorStatus = result.response?.errors?.[0]?.status;
        if (errorStatus === '200' || errorStatus === '400') {
          code = 'Data_Error';
          description = 'Invalid or missing customer data';
        } else {
          code = result.response?.errors?.[0]?.status || '-101';
          description = result.response?.errors?.[0]?.detail ||
            result.response?.errors?.[0]?.title ||
            'Error processing request';
        }
      }

      if (!distribution[code]) {
        distribution[code] = {
          description: description,
          count: 0
        };
      }
      distribution[code].count++;
    });

    return Object.entries(distribution).map(([code, data]) => ({
      responseCode: code,
      description: data.description,
      count: data.count
    }));
  };

  const getDistributionColumns = () => [
    { field: 'responseCode', headerName: 'Response Code', width: 150 },
    { field: 'description', headerName: 'Eligibility Description', width: 250 },
    { field: 'count', headerName: 'Number of Customers', width: 174 }
  ];

  const getPieChartData = () => {
    const data = getDistributionData();

    return {
      labels: data.map(item => `${item.responseCode} (${item.count})`),
      datasets: [{
        data: data.map(item => item.count),
        backgroundColor: data.map(item => {
          switch (item.responseCode) {
            case '1': return '#4CAF50';  // Green for eligible
            case '-3': return '#F44336';  // Red for ineligible
            case 'Data_Error': return '#36A2EB';  // Blue for data errors
            default: return '#FFC107';  // Yellow for other errors
          }
        }),
        borderColor: '#fff',
        borderWidth: 1,
      }]
    };
  };

  return (
    <div className="container" style={{ maxWidth: '1200px', margin: '0 auto', padding: '40px 20px' }}>
      <div style={{
        backgroundColor: 'white',
        borderRadius: '8px',
        padding: '24px',
        boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
        marginBottom: '30px'
      }}>
        {/* Manual PurposeID Lookup UI */}
        <div style={{ margin: '24px 0' }}>
          <input
            type="text"
            placeholder="Enter Purpose ID"
            value={manualPurposeId}
            onChange={e => setManualPurposeId(e.target.value)}
            style={{ padding: 8, width: 220, marginRight: 8 }}
          />
          <button
            onClick={fetchManualCustomer}
            style={{ padding: '8px 16px', background: '#1976d2', color: 'white', border: 'none', borderRadius: 4 }}
            disabled={!manualPurposeId.trim()}
          >
            Check Eligibility
          </button>
        </div>
        {manualError && <div style={{ color: 'red', marginBottom: 8 }}>{manualError}</div>}
        {manualResult && (
          <div style={{ marginBottom: 16 }}>
            <h3>Customer Result</h3>
            <div style={{width: 382, marginTop: -10 }}>
              <DataGrid
              autoHeight
                rows={(() => {
                  if (manualResult?.data?.Status === "CE") {
                    return [{
                      id: 1,
                      eligibilityCode: manualResult.data.responsecode,
                      eligibilityDescription: manualResult.data.responsedescription
                    }];
                  }
                  // Handle error responses
                  const errorStatus = manualResult?.errors?.[0]?.status;
                  let eligibilityCode, eligibilityDescription;
                  if (ERROR_CODE_MESSAGES[errorStatus]) {
                    eligibilityCode = errorStatus;
                    eligibilityDescription = ERROR_CODE_MESSAGES[errorStatus];
                  } else {
                    eligibilityCode = errorStatus || '-101';
                    eligibilityDescription =
                      manualResult?.errors?.[0]?.detail ||
                      manualResult?.errors?.[0]?.title ||
                      'Error processing request';
                  }
                  return [{
                    id: 1,
                    eligibilityCode,
                    eligibilityDescription
                  }];
                })()}
                columns={[
                  { field: 'eligibilityCode', headerName: 'Eligibility Code', width: 140 },
                  { field: 'eligibilityDescription', headerName: 'Eligibility Description', width: 240 }
                ]}
                pageSize={1}
                rowsPerPageOptions={[1]}
                hideFooter
                disableSelectionOnClick
                sx={{
                  fontSize: '.95rem',
                  '& .MuiDataGrid-columnHeader, & .MuiDataGrid-cell': {
                    whiteSpace: 'normal',
                    wordBreak: 'break-word',
                    lineHeight: '1.2',
                    display: 'flex',
                    alignItems: 'center',
                    borderRight: '1.5px solid #e0e0e0'
                  },
                  '& .MuiDataGrid-columnSeparator': {
                    display: 'none !important'
                  },
                  '& .MuiDataGrid-columnHeaderTitle': {
                    whiteSpace: 'normal',
                    wordBreak: 'break-word',
                    lineHeight: '1.2',
                    fontWeight: 'bold'
                  },
                  '& .MuiDataGrid-columnHeader': {
                    backgroundColor: '#4CAF50',
                  }
                }}
              />
            </div>
          </div>
        )}
        <div style={{ marginTop: '20px' }}>
          <input
            type="file"
            accept=".csv"
            onChange={handleCSVUpload}
            style={{ marginBottom: '10px' }}
          />
        </div>
        <br />
        <button
          onClick={checkAllRows}
          disabled={csvRows.length === 0}
          style={{
            backgroundColor: csvRows.length === 0 ? '#ccc' : '#1976d2',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            padding: '10px 24px',
            fontSize: '1rem',
            cursor: csvRows.length === 0 ? 'not-allowed' : 'pointer',
            marginBottom: '24px'
          }}
        >
          Submit
        </button>
        {/* Only show results after CSV upload and processing */}
        {bulkResults.length > 0 && (
          <>
            <div style={{ display: 'flex', gap: '20px' }}>
              {/* Left: Eligibility Distribution Table */}
              <div style={{ width: '50%' }}>
                <h3>Eligibility Distribution</h3>
                <hr
                  style={{
                    border: 0,
                    borderTop: '2px solid #2196f3',
                    margin: '-10px 0 16px 0'
                  }}
                />
                <div style={{ height: 320 }}>
                  <DataGrid
                    rows={getDistributionData().map((item, index) => ({ ...item, id: index }))}
                    columns={getDistributionColumns()}
                    pageSize={5}
                    rowsPerPageOptions={[5]}
                    disableSelectionOnClick
                    sx={{
                      fontSize: '.95rem',
                      '& .MuiDataGrid-columnHeader, & .MuiDataGrid-cell': {
                        whiteSpace: 'normal',
                        wordBreak: 'break-word',
                        lineHeight: '1.2',
                        display: 'flex',
                        alignItems: 'center',
                        borderRight: '1px solid #e0e0e0'
                      },
                      '& .MuiDataGrid-columnSeparator': {
                        display: 'none !important'
                      },
                      '& .MuiDataGrid-columnHeaderTitle': {
                        whiteSpace: 'normal',
                        wordBreak: 'break-word',
                        lineHeight: '1.2',
                        fontWeight: 'bold'
                      },
                      '& .MuiDataGrid-columnHeader': {
                        backgroundColor: '#36A2EB',
                      }
                    }}
                  />
                </div>
              </div>
              {/* Right: Pie Chart */}
              <div style={{ width: '50%' }}>
                <h3>Visual Distribution</h3>
                <hr
                  style={{
                    border: 0,
                    borderTop: '2px solid #2196f3',
                    margin: '-10px 0 16px 0'
                  }}
                />
                <div style={{ height: 300 }}>
                  <Pie
                    data={getPieChartData()}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: {
                          position: 'right'
                        }
                      }
                    }}
                  />
                </div>
              </div>
            </div>
          </>
        )}
        {bulkResults.length > 0 && (
          <>
            <div style={{ marginTop: '30px' }}></div>
            <h3>Bulk Results</h3>
            <button onClick={exportToCSV}>Export Results to CSV</button>
            <div style={{ height: 400, width: '100%', marginTop: 20 }}>
              <DataGrid
                rows={getTableRows()}
                columns={getTableColumns()}
                pageSize={10}
                rowsPerPageOptions={[10, 25, 50, 100]}
                disableSelectionOnClick
                sx={{
                  fontSize: '.95rem',
                  '& .MuiDataGrid-columnHeader, & .MuiDataGrid-cell': {
                    whiteSpace: 'normal',
                    wordBreak: 'break-word',
                    lineHeight: '1.2',
                    display: 'flex',
                    alignItems: 'center',
                    borderRight: '1.5px solid #e0e0e0'
                  },
                  '& .MuiDataGrid-columnSeparator': {
                    display: 'none !important'
                  },
                  '& .MuiDataGrid-columnHeaderTitle': {
                    whiteSpace: 'normal',
                    wordBreak: 'break-word',
                    lineHeight: '1.2',
                    fontWeight: 'bold'
                  },
                  '& .MuiDataGrid-columnHeader': {
                    backgroundColor: '#4CAF50',
                  }
                }}
              />
            </div>
          </>
        )}
        {error && <p style={{ color: "red" }}>{error}</p>}
      </div>
    </div>
  );
}

export default App;