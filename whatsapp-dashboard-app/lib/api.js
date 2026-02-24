function ok(data = null) {
    return { success: true, ...(data != null && { data }) };
}

function fail(code, message, details = null) {
    const body = { success: false, error: message, code };
    if (details != null) body.details = details;
    return body;
}

function sendOk(res, data, status = 200) {
    res.status(status).json(data && typeof data === 'object' && !Array.isArray(data) && data.success === true ? data : ok(data));
}

function sendFail(res, code, message, status = 400, details = null) {
    res.status(status).json(fail(code, message, details));
}

module.exports = { ok, fail, sendOk, sendFail };
