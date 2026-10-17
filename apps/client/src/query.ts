/** 页面 URL 查询。在函数体内读 location，模块加载时不碰 DOM，Node 测试才能导入。 */
export function pageQuery(): URLSearchParams {
  return new URLSearchParams(location.search);
}
