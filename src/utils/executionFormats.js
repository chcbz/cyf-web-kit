/** Display names only; availability always comes from the authenticated capabilities endpoint. */
export const deliveryTypeText = value => ({
  'image/png': 'PNG 图片',
  'image/jpeg': 'JPEG 图片',
  'application/pdf': 'PDF',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Word（DOCX）',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Excel（XLSX）',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'PPT（PPTX）'
})[value] || '未知交付类型'
