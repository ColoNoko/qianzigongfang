import { describe, expect, it } from 'vitest'
import { PROJECT_FORM_HINTS, PROJECT_FORM_REQUIRED } from '../project-form-hints'

describe('project-form-hints：「添加项目」弹窗的文案契约', () => {
  it('四句框内提示逐字锁定（用户 2026-10-04 的原话，不许顺手润色）', () => {
    expect(PROJECT_FORM_HINTS).toEqual({
      folderPath: '填入想选漫画对应的文件夹地址',
      parentTitle: '已有漫画下拉列表选择；新加漫画在此输入期望标题',
      chapterNumber: '单话集数，可汉字（如番外）；初次新建无需填写。',
      projectTitle: '单话标题；初次新建无需填写。'
    })
  })

  it('必填清单 = 保存按钮真正会卡住的那两项（路径 / 漫画名称(父级)）', () => {
    expect([...PROJECT_FORM_REQUIRED]).toEqual(['folderPath', 'parentTitle'])
  })
})
