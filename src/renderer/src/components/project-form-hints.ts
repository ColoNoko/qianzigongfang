/** 添加项目弹窗的字段提示；样式由组件负责。 */
export const PROJECT_FORM_HINTS = {
  /** 1. 项目所在文件夹路径 */
  folderPath: '填入想选漫画对应的文件夹地址',
  /** 2. 漫画名称(父级) */
  parentTitle: '已有漫画下拉列表选择；新加漫画在此输入期望标题',
  /** 3. 集数 */
  chapterNumber: '单话集数，可汉字（如番外）；初次新建无需填写。',
  /** 4. 项目标题（单话标题） */
  projectTitle: '单话标题；初次新建无需填写。'
} as const

export type ProjectFormHintKey = keyof typeof PROJECT_FORM_HINTS

/**
 * 必填项 —— 与 `ProjectFormModal` 的保存判据（`canSave`）**逐条对应**：
 *   · 项目所在文件夹路径：`pathValid === true`（读得到 + 不是别的章节的上级目录）
 *   · 漫画名称(父级)：非空
 * 集数与项目标题**可选**（空集数照旧允许，见交接文档 §16.1 第 2 条）。
 *
 * ⚠️ 星号必须与这份清单同源：给可选字段挂星号等于说谎，而星号一多就等于没有星号。
 */
export const PROJECT_FORM_REQUIRED: readonly ProjectFormHintKey[] = ['folderPath', 'parentTitle']
