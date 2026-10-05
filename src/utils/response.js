export const ok = (res, data, meta, status = 200) => {
  const body = { success: true, data };
  if (meta) body.meta = meta;
  return res.status(status).json(body);
};
export const created = (res, data, meta) => ok(res, data, meta, 201);
