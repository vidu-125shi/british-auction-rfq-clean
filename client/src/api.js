function userId() {
  return localStorage.getItem('userId') || '';
}

async function request(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-User-Id': userId()
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(json?.error?.message || `HTTP ${res.status}`);
    err.code = json?.error?.code;
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

export const api = {
  listUsers:   ()                => request('GET',  '/api/users'),
  listRfqs:    ()                => request('GET',  '/api/rfqs'),
  getRfq:      (id)              => request('GET',  `/api/rfqs/${id}`),
  createRfq:   (body)            => request('POST', '/api/rfqs', body),
  submitBid:   (rfqId, body)     => request('POST', `/api/rfqs/${rfqId}/bids`, body)
};
