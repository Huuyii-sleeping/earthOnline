(function() {
  var style = getComputedStyle(document.documentElement);
  var accent = style.getPropertyValue('--accent').trim();
  var accent2 = style.getPropertyValue('--accent2').trim();
  var ink = style.getPropertyValue('--ink').trim();
  var muted = style.getPropertyValue('--muted').trim();
  var rule = style.getPropertyValue('--rule').trim();
  var bg2 = style.getPropertyValue('--bg2').trim();

  // --- Chart: 模块完成度雷达图 ---
  var radarDom = document.getElementById('chart-radar');
  if (radarDom) {
    var radarChart = echarts.init(radarDom, null, { renderer: 'svg' });
    radarChart.setOption({
      animation: false,
      tooltip: {
        trigger: 'item',
        appendToBody: true
      },
      legend: {
        data: ['当前完成度', '目标 (100%)'],
        bottom: 0,
        textStyle: { color: ink, fontFamily: 'Instrument Sans' }
      },
      radar: {
        center: ['50%', '50%'],
        radius: '65%',
        indicator: [
          { name: '前端 Web', max: 100 },
          { name: 'Go API', max: 100 },
          { name: 'Agent 服务', max: 100 },
          { name: '共享包', max: 100 },
          { name: '基础设施', max: 100 }
        ],
        axisName: { color: muted, fontSize: 12, fontFamily: 'Instrument Sans' },
        splitArea: { areaStyle: { color: [bg2, 'transparent'] } },
        splitLine: { lineStyle: { color: rule } },
        axisLine: { lineStyle: { color: rule } }
      },
      series: [
        {
          type: 'radar',
          name: '当前完成度',
          data: [{ value: [75, 45, 15, 80, 40], name: '当前' }],
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { color: accent, width: 2 },
          areaStyle: { color: accent + '33' },
          itemStyle: { color: accent }
        },
        {
          type: 'radar',
          name: '目标 (100%)',
          data: [{ value: [100, 100, 100, 100, 100], name: '目标' }],
          symbol: 'none',
          lineStyle: { color: accent2, width: 1.5, type: 'dashed' },
          areaStyle: { color: 'transparent' },
          itemStyle: { color: accent2 }
        }
      ]
    });
    window.addEventListener('resize', function() { radarChart.resize(); });
  }

  // --- Chart: 里程碑依赖桑基图 ---
  var sankeyDom = document.getElementById('chart-sankey');
  if (sankeyDom) {
    var sankeyChart = echarts.init(sankeyDom, null, { renderer: 'svg' });
    sankeyChart.setOption({
      animation: false,
      tooltip: {
        trigger: 'item',
        triggerOn: 'mousemove',
        appendToBody: true
      },
      series: [{
        type: 'sankey',
        layout: 'none',
        emphasis: { focus: 'adjacency' },
        nodeAlign: 'left',
        layoutIterations: 0,
        data: [
          { name: 'M1 框架完善', itemStyle: { color: accent } },
          { name: 'M2 经历对话', itemStyle: { color: accent } },
          { name: 'M3 奖章生成', itemStyle: { color: accent } },
          { name: 'M4 素材视觉', itemStyle: { color: accent2 } },
          { name: 'M5 个人主页', itemStyle: { color: accent2 } },
          { name: 'M6 社交流', itemStyle: { color: accent2 } },
          { name: 'M7 阶段产出', itemStyle: { color: muted } }
        ],
        links: [
          { source: 'M1 框架完善', target: 'M2 经历对话', value: 1 },
          { source: 'M2 经历对话', target: 'M3 奖章生成', value: 1 },
          { source: 'M3 奖章生成', target: 'M4 素材视觉', value: 1 },
          { source: 'M3 奖章生成', target: 'M5 个人主页', value: 1 },
          { source: 'M5 个人主页', target: 'M6 社交流', value: 1 },
          { source: 'M6 社交流', target: 'M7 阶段产出', value: 1 }
        ],
        label: {
          show: true,
          position: 'right',
          fontSize: 12,
          fontFamily: 'Instrument Sans',
          color: ink
        },
        lineStyle: {
          color: 'gradient',
          curveness: 0.5
        }
      }]
    });
    window.addEventListener('resize', function() { sankeyChart.resize(); });
  }
})();