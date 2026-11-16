// Datas no formato do SOT: "YYYY-MM-DD" (o <picker mode="date"> usa o mesmo).
function today() {
  const d = new Date();
  const p = (n) => (n < 10 ? "0" + n : "" + n);
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

/** "2026-12-10" → "10/12/2026". */
function show(day) {
  if (!day) return "—";
  const [y, m, d] = day.split("-");
  return d + "/" + m + "/" + y;
}

module.exports = { today, show };
