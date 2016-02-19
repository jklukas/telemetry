// vim: set ts=2 sw=2 tw=99 et:
var USE_S3_FOR_CHART_DATA = true;

function ChartDisplay(app)
{
  this.app = app;
  this.activeHover = null;
  this.data = {};
}

ChartDisplay.prototype.clear = function()
{
  this.removeHover();
  
  // Clear callbacks for XHR.
  for (var key in this.data) {
    var state = this.data[key];
    if (state.callbacks)
      state.callbacks = [];
  }

  $("#viewport").empty();
}

ChartDisplay.prototype.removeHover = function()
{
  if (!this.activeHover)
    return;
  this.activeHover.remove();
  this.activeHover = null;
}

ChartDisplay.prototype.prepareChartDiv = function (id, title, width, height)
{
  var elt = $('<div/>', {
    id: id,
    width: width,
    height: height
  });
  $('#viewport').append(
    $('<h4></h4>').text(title)
  );
  $('#viewport').append(elt);
  $('#viewport').append($('<br>'));
  $('#viewport').append($('<br>'));
  return elt;
}

ChartDisplay.prototype.drawChart = function (type, elt, data, aOptions)
{
  aOptions = aOptions || {};

  if (type == 'pie')
    return this.drawPieChart(elt, data);

  var options = {
    series: {},
    legend: {
      show: true,
    },
    grid: {
      hoverable: true,
      clickable: true,
    }
  };

  var dataset = [];
  switch (type) {
  case 'bar':
    dataset.push(data.series);
    options.series.bars = {
      show: true,
      align: 'center',
      barWidth: 0.6,
      fill: true,
      lineWidth: 0,
      fillColor: 'rgb(155,200,123)',
    };

    var ticks = [];
    for (var i = 0; i < data.labels.length; i++)
      ticks.push([i, data.labels[i]]);
    options.xaxis = {
      ticks: ticks,
    };

    options.yaxis = {};
    options.yaxis.tickFormatter = data.formatter;
    break;
  };

  // Merge custom options.
  for (var key in aOptions) {
    if (typeof(aOptions[key]) != 'object')
      continue;
    for (var subkey in aOptions[key])
      options[key][subkey] = aOptions[key][subkey];
  }

  $.plot(elt, dataset, options);
  elt.bind('plothover', (function (event, pos, obj) {
    if (!obj) {
      this.removeHover();
      return;
    }
    if (this.activeHover) {
      if (this.activeHover.id == event.target && this.activeHover.label == obj.seriesIndex)
        return;
      this.removeHover();
    }

    var item = data.labels[obj.dataIndex];
    var value = data.series[obj.dataIndex][1];
    var text = item + " - " + data.formatter(value.toFixed(2));

    this.activeHover = new ToolTip(event.target, obj.seriesIndex, text);
    this.activeHover.draw(pos.pageX, pos.pageY);
  }).bind(this));
}

ChartDisplay.prototype.drawPieChart = function(elt, data)
{
  data.sort(function(a, b) {
    return b.data - a.data;
  });
  var percentages = {};
  var total = 0;
  for (var i = 0; i < data.length; i++)
    total += data[i].data;
  for (var i = 0; i < data.length; i++)
    percentages[data[i].label] = ((data[i].data / total) * 100).toFixed(1);

  var options = {
    series: {
      pie: {
        show: true,
        label: {
          show: false,
        },
      },
    },
    legend: {
      show: true,
      labelFormatter: function(label, series) {
        return label + ' - ' + percentages[label] + '%';
      },
    },
    grid: {
      hoverable: true,
      clickable: true,
    }
  };

  $.plot(elt, data, options);
  elt.bind('plothover', (function (event, pos, obj) {
    if (!obj) {
      this.removeHover();
      return;
    }
    if (this.activeHover) {
      if (this.activeHover.id == event.target && this.activeHover.label == obj.seriesIndex)
        return;
      this.removeHover();
    }

    var label = data[obj.seriesIndex].label;
    var text = label + " - " + percentages[label] + "% (" + data[obj.seriesIndex].data + " sessions)";

    this.activeHover = new ToolTip(event.target, obj.seriesIndex, text);
    this.activeHover.draw(pos.pageX, pos.pageY);
  }).bind(this));
}

ChartDisplay.prototype.drawTable = function(selector, devices)
{
  var GetDeviceName = function(device) {
    if (device in PCIDeviceMap)
      return PCIDeviceMap[device];
    var parts = device.split('/');
    if (parts.length == 2)
      return LookupVendor(parts[0]) + ' ' + parts[1];
    return device;
  }

  var device_list = [];
  var total = 0;
  for (var device in devices) {
    total += devices[device];
    device_list.push({
      name: GetDeviceName(device),
      count: devices[device]
    });
  }
  device_list.sort(function(a, b) {
    return b.count - a.count;
  });

  var table = $('<table></table>');
  for (var i = 0; i < device_list.length; i++) {
    var row = $('<tr></tr>');
    row.append($('<td>' + device_list[i].name + '</td>'));
    row.append($('<td>' + ((device_list[i].count / total) * 100).toFixed(2) + '%</td>'));
    row.append($('<td>(' + device_list[i].count + ')</td>'));
    table.append(row);
  }
  $(selector).append(table);
}

ChartDisplay.prototype.ensureData = function (key, callback)
{
  if (key in this.data) {
    if (this.data[key].obj)
      return this.data[key].obj;

    this.data[key].callbacks.push(callback);
    return null;
  }

  var state = {
      callbacks: [callback],
      obj: null,
  };
  this.data[key] = state;

  var prefix = (USE_S3_FOR_CHART_DATA &&
                (key != 'snapshots.json'))
               ? 'https://analysis-output.telemetry.mozilla.org/gfx-telemetry/data/'
               : 'data/';

  $.ajax({
    url: prefix + key,
    dataType: 'json',
  }).done(function (data) {
    state.obj = (typeof data == 'string')
                ? JSON.parse(data)
                : data;

    var callbacks = state.callbacks;
    state.callbacks = null;

    for (var i = 0; i < callbacks.length; i++)
      callbacks[i](state.obj);
  });
}

// Combine unknown keys into one key, aggregating it.
ChartDisplay.prototype.reduce = function (data, combineKey, threshold, callback)
{
  var total = 0;
  for (var key in data)
    total += data[key];

  var copy = {};
  if (combineKey in data)
    copy[combineKey] = data[combineKey];

  for (var key in data) {
    if ((!callback || callback(key)) && (data[key] / total >= threshold))
      copy[key] = data[key];
    else if (key != combineKey)
      copy[combineKey] = (copy[combineKey] | 0) + data[key];
  }
  return copy;
}

// Re-aggregate a dictionary based on a key transformation.
ChartDisplay.prototype.mapToKeyedAgg = function (data, keyfn, labelfn)
{
  var out = {};
  for (var key in data) {
    var new_key = keyfn(key);
    if (new_key in out)
      out[new_key].count += data[key];
    else
      out[new_key] = { count: data[key], label: labelfn(key, new_key) };
  }
  return out;
}

// Reduce a keyed aggregation based on a threshold.
ChartDisplay.prototype.reduceAgg = function (data, threshold, combineKey, combineLabel)
{
  var total = 0;
  for (var key in data)
    total += data[key].count;

  var out = {};
  for (var key in data) {
    if (data[key].count / total < threshold) {
      if (combineKey in out) {
        out[combineKey].count += data[key].count;
      } else {
        out[combineKey] = {
          count: data[key].count,
          label: combineLabel,
        };
      }
    } else {
      out[key] = data[key];
    }
  }
  return out;
}

ChartDisplay.prototype.aggToSeries = function (data)
{
  var series = [];
  for (var key in data) {
    series.push({
      key: key,
      label: data[key].label,
      data: data[key].count,
    });
  }
  return series;
}

ChartDisplay.prototype.createOptionList = function (map, namer)
{
  var list = [];
  for (var key in map)
    list.push([key, namer ? namer(key) : key]);
  list.sort(function (item1, item2) {
    var a = item1[1];
    var b = item2[1];
    if (a < b)
      return -1;
    if (a > b)
      return 1;
    return 0;
  });

  var options = [];
  for (var i = 0; i < list.length; i++) {
    options.push({
      value: list[i][0],
      text: list[i][1],
    });
  }
  return options;
}

ChartDisplay.prototype.listToSeries = function (input, namer)
{
  var series = [];
  for (var i = 0; i < input.length; i++) {
    series.push({
      label: namer(i),
      data: input[i],
    });
  }
  return series;
};

ChartDisplay.prototype.mapToSeries = function (input, namer)
{
  var series = [];
  for (var key in input) {
    series.push({
      label: namer ? namer(key) : key,
      data: input[key],
    });
  }
  return series;
};

ChartDisplay.prototype.toPercent = function (val)
{
  return parseFloat((val * 100).toFixed(2));
}

ChartDisplay.prototype.drawSampleInfo = function (obj)
{
  var info_div = $("<div/>")
    .hide();

  var chart_div = $('<div/>', {
    id: 'session-source-info',
    width: 300,
    height: 150
  });

  var renderInfo = (function () {
    var series = this.mapToSeries(obj.sessions.share, function (key) {
      return "Firefox " + key;
    });
    this.drawPieChart(chart_div, series);
  }).bind(this);

  var href = $("<a>")
    .text("Click to show sample information.")
    .attr('href', '#')
    .click((function (e) {
      e.preventDefault();

      if (info_div.is(":visible")) {
        info_div.hide();
        href.text('Click to show sample information.');
      } else {
        info_div.show();
        renderInfo();
        href.text('Click to hide sample information.');
      }
    }).bind(this));

  $("#viewport").append(
      $("<p></p>").append(
        $("<strong></strong>").append(href)
      ),
      info_div
  );

  var blobs = [];
  for (var i = 0; i < obj.sessions.metadata.length; i++) {
    var md = obj.sessions.metadata[i].info;
    var channel = (md.channel == '*')
                  ? 'all'
                  : md.channel;
    var text = channel + ' (';
    if (md.day_range)
      text += md.day_range + ' days of sessions';
    else
      text += 'builds from the last ' + md.build_range + ' days';
    text += ')';
    blobs.push(text);
  }

  var sourceText = (new Date(obj.sessions.timestamp * 1000)).toLocaleDateString() +
                   ', channels: ' + blobs.join(', ');

  info_div.append(
      $("<p></p>").append(
        $("<strong></strong>").text("Size: ")
      ).append(
        $("<span></span>").text(obj.sessions.count.toLocaleString() + " sessions")
      ),
      $("<p></p>").append(
        $("<strong></strong>").text("Source: ")
      ).append(
        $("<span></span>").text(sourceText)
      ),
      $('<h4></h4>').text('Sample Makeup'),
      $('<br>'),
      $('<br>'),
      chart_div
  );
};