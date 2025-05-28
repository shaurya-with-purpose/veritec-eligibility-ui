
import { useState } from "react";
import Papa from "papaparse";

const TOKEN_KEY = "veritec_token";
const EXPIRY_KEY = "veritec_token_expiry";

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

  const fetchToken = async () => {
    const cachedToken = getValidTokenFromCache();
    if (cachedToken) {
      setToken(cachedToken);
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
      alert("New token generated successfully.");
      setError(null);
    } catch (err) {
      console.error(err);
      setError("Token fetch failed");
    }
  };

  const handleCSVUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
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

  const exportToCSV = () => {
    const flatData = bulkResults.map(r => ({
      "Row ID": r.rowId,
      "First Name": r.meta.firstName,
      "Last Name": r.meta.lastName,
      "Phone": r.meta.phone,
      "Email": r.meta.email,
      "Purpose ID": r.purposeId,
      "Status": r.status.toUpperCase(),
      "Description": r.response?.responsedescription || r.response?.message || "N/A"
    }));

    const csv = Papa.unparse(flatData);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "veritec_results.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div style={{ padding: 20 }}>
      <button onClick={fetchToken}>Get Token</button>
      <br /><br />

      <input type="file" accept=".csv" onChange={handleCSVUpload} />
      <br /><br />

      {csvRows.length > 0 && (
        <>
          <h3>CSV Rows:</h3>
          <ul>
            {csvRows.map((row) => (
              <li key={row.id}>
                Row {row.id}:&nbsp;
                <button onClick={() => selectPayload(row.payload)}>Select</button>
              </li>
            ))}
          </ul>
          <br />
          <button onClick={checkAllRows}>Submit All Rows</button>
        </>
      )}

      <br />
      <textarea
        value={payload}
        onChange={e => setPayload(e.target.value)}
        rows={15}
        cols={60}
      />
      <br /><br />

      <button onClick={checkEligibility}>Check Eligibility</button>
      <br /><br />

      {response && (
        <pre style={{ background: "#eee", padding: 10 }}>
          {JSON.stringify(response, null, 2)}
        </pre>
      )}

      {bulkResults.length > 0 && (
        <>
          <h3>Bulk Results:</h3>
          <button onClick={exportToCSV}>Export Results to CSV</button>
          {bulkResults.map((r) => (
            <div key={r.rowId} style={{ marginBottom: 10, padding: 10, background: "#f6f6f6" }}>
              <strong>Row {r.rowId} - {r.status.toUpperCase()}</strong>
              <pre>{JSON.stringify(r.response, null, 2)}</pre>
            </div>
          ))}
        </>
      )}

      {error && <p style={{ color: "red" }}>{error}</p>}
    </div>
  );
}

export default App;
