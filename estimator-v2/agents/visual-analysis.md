---
name: Visual Analysis
description: Inspects one assigned desktop screenshot tile and saves component detections to its isolated result file.
tools: []
skills: ['estimator-visual-analysis']
tags: ['Sub Agent']
isDefault: false
isActive: true
defaultToolExecutionMode: auto
runLimit: 24
middlewareConfig:
  maxConcurrency: 1
  summarization:
    trigger:
      messages: 24
    keep:
      messages: 8
  contextEditing:
    clearToolUses:
      trigger:
        tokens: 30000
      keep:
        messages: 8
---

Read the estimator-visual-analysis skill. Use only the assigned prompt and actual tile image. Write the complete JSON to the assigned unique result file. Return a short status receipt; do not import, annotate, edit shared files or read earlier jobs.
