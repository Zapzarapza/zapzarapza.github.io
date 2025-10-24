// Default CSV data shown in the textarea on load
const DEFAULT_CSV_DATA = `id,start,end
Project A,2024-01-01,2024-05-15
Project B,2024-02-10,2024-07-20
Project C,2024-04-01,2024-06-10
Project D,2024-05-01,2024-09-01
Project E,2024-06-15,2024-08-30
Project F,2024-01-20,2024-03-10
Project G,2024-02-15,2024-04-15
Project H,2024-07-01,2024-10-01`;

document.addEventListener("DOMContentLoaded", initApp);

// Utility function to debounce repeated calls
function debounce(func, delay) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
    };
}

// Ensure PapaParse is available. If not, load it dynamically from CDN.
function ensurePapaLoaded() {
    return new Promise((resolve, reject) => {
        if (window.Papa) return resolve(window.Papa);

        // If we've already injected a dynamic script, wait for it
        const existing = document.querySelector('script[data-papa-dynamic]');
        if (existing) {
            existing.addEventListener('load', () => {
                if (window.Papa) resolve(window.Papa); else reject(new Error('PapaParse loaded but global "Papa" not found'));
            });
            existing.addEventListener('error', () => reject(new Error('Failed to load PapaParse')));
            return;
        }

        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/PapaParse/4.6.0/papaparse.min.js';
        script.async = true;
        script.setAttribute('data-papa-dynamic', '1');
        script.onload = () => {
            if (window.Papa) resolve(window.Papa);
            else reject(new Error('PapaParse loaded but global "Papa" not found'));
        };
        script.onerror = () => reject(new Error('Failed to load PapaParse script from CDN'));
        document.head.appendChild(script);
    });
}

// UI helpers for status and errors
function showIndicator() {
    const el = document.getElementById('rendering-indicator');
    if (el) el.style.display = '';
}

function hideIndicator() {
    const el = document.getElementById('rendering-indicator');
    if (el) el.style.display = 'none';
}

function showErrors(message) {
    const el = document.getElementById('parse-errors');
    if (el) el.textContent = message;
}

function clearErrors() {
    const el = document.getElementById('parse-errors');
    if (el) el.textContent = '';
}

// Initialize the app: prefill textarea, draw initial chart and wire live updates
function initApp() {
    const textarea = document.getElementById("csvInput");
    if (!textarea) return;

    // Prefill with default CSV and draw initial chart
    textarea.value = DEFAULT_CSV_DATA;
    // Draw initial chart immediately
    handleCsvText(DEFAULT_CSV_DATA);

    // Redraw (debounced) on user input to avoid excessive re-renders while typing
    const debouncedHandleCsvText = debounce(handleCsvText, 300);
    textarea.addEventListener("input", (event) => {
        debouncedHandleCsvText(event.target.value);
    });
}

// Parse CSV text (string) and pass parsed rows to the drawing function
function handleCsvText(csvText) {
    // Clear previous errors and show rendering indicator. Use setTimeout(0)
    // so the browser can paint the indicator before parsing/drawing.
    clearErrors();
    showIndicator();

    setTimeout(() => {
        // Ensure PapaParse library is available before parsing
        ensurePapaLoaded().then(() => {
            Papa.parse(csvText, {
                header: true,         // First row is the header
                dynamicTyping: false, // IMPORTANT: Disable, so date strings are not parsed as numbers
                skipEmptyLines: true, // Skip empty rows
                complete: function (results) {
                    // If PapaParse reported errors, show them inline instead of alert()
                    if (results.errors && results.errors.length > 0) {
                        const msgs = results.errors.map(e => {
                            return `${e.message}${typeof e.row === 'number' ? ' (row ' + e.row + ')' : ''}`;
                        }).join('\n');
                        showErrors(msgs);
                        hideIndicator();
                        return;
                    }

                    // Basic schema validation: ensure id, start, end columns exist
                    const fields = results.meta && results.meta.fields ? results.meta.fields.map(f => String(f).toLowerCase()) : [];
                    const required = ['id', 'start', 'end'];
                    const missing = required.filter(r => !fields.includes(r));
                    if (missing.length > 0) {
                        showErrors('Missing required column(s): ' + missing.join(', ') + '. Required: id, start, end.');
                        hideIndicator();
                        return;
                    }

                    // Build a map of lowercase field -> actual header name for case-insensitive access
                    const fieldMap = {};
                    (results.meta.fields || []).forEach(f => { fieldMap[String(f).toLowerCase()] = f; });

                    // Row-level validation: check each row for missing/invalid id/start/end and end >= start
                    const rowErrors = [];
                    results.data.forEach((row, idx) => {
                        // Display row number relative to the CSV (header is row 1)
                        const rowNum = idx + 2;
                        const idVal = (row[fieldMap['id']] !== undefined && row[fieldMap['id']] !== null) ? String(row[fieldMap['id']]).trim() : '';
                        const startRaw = (row[fieldMap['start']] !== undefined && row[fieldMap['start']] !== null) ? String(row[fieldMap['start']]).trim() : '';
                        const endRaw = (row[fieldMap['end']] !== undefined && row[fieldMap['end']] !== null) ? String(row[fieldMap['end']]).trim() : '';

                        if (!idVal) {
                            rowErrors.push(`Row ${rowNum}: missing or empty 'id'`);
                        }

                        // Validate dates
                        const startDate = startRaw ? new Date(startRaw) : null;
                        const endDate = endRaw ? new Date(endRaw) : null;

                        if (!startRaw) {
                            rowErrors.push(`Row ${rowNum}: missing 'start'`);
                        } else if (isNaN(startDate)) {
                            rowErrors.push(`Row ${rowNum}: invalid 'start' date -> "${startRaw}"`);
                        }

                        if (!endRaw) {
                            rowErrors.push(`Row ${rowNum}: missing 'end'`);
                        } else if (isNaN(endDate)) {
                            rowErrors.push(`Row ${rowNum}: invalid 'end' date -> "${endRaw}"`);
                        }

                        if (startDate && endDate && !isNaN(startDate) && !isNaN(endDate)) {
                            if (endDate < startDate) {
                                rowErrors.push(`Row ${rowNum}: 'end' (${endRaw}) is before 'start' (${startRaw})`);
                            }
                        }
                    });

                    if (rowErrors.length > 0) {
                        // Show up to first 200 rows worth of errors to prevent flooding UI
                        showErrors(rowErrors.slice(0, 200).join('\n'));
                        hideIndicator();
                        return;
                    }

                    try {
                        // Pass parsed rows to the existing drawing function
                        processDataAndDrawChart(results.data);
                    } catch (err) {
                        showErrors('Error while drawing chart: ' + (err && err.message ? err.message : String(err)));
                    } finally {
                        hideIndicator();
                    }
                },
                error: function (err) {
                    showErrors('Parse error: ' + (err && err.message ? err.message : String(err)));
                    hideIndicator();
                }
            });
        }).catch(err => {
            showErrors('Failed to load PapaParse: ' + (err && err.message ? err.message : String(err)) + '\nYou can include PapaParse manually via a script tag or check your network/permission settings.');
            hideIndicator();
        });
    }, 0);
}

// 3. Process the data AND draw the chart
function processDataAndDrawChart(rawData) {

    // 3.1. Clean and parse data (convert strings to Date objects)
    const data = rawData.map(d => ({
        id: String(d.id),
        start: new Date(d.start), // Parse as Date
        end: new Date(d.end)       // Parse as Date
    })).filter(d =>
        d.id &&
        !isNaN(d.start) && // Check if the start date is valid
        !isNaN(d.end) &&   // Check if the end date is valid
        d.end >= d.start   // 'start' must be before or equal to 'end'
    );

    // If no valid data is found, alert the user and stop.
    if (data.length === 0) {
        alert("No valid data found. Please check the CSV format (id, start, end) and ensure 'start' and 'end' are valid date strings (e.g., 2024-01-30).");
        return;
    }

    // --- DATA TRANSFORMATION for d3.stack ---
    // We must convert the (id, start, end) format into a "timeseries" format
    // that d3.stack() can understand.

    // 3.2. Find all unique IDs (these will be the "layers")
    const keys = Array.from(new Set(data.map(d => d.id)));

    // 3.3. Find the total time range
    const minTime = d3.min(data, d => d.start);
    const maxTime = d3.max(data, d => d.end);

    // 3.4. Create a "snapshot" for each day in the time range
    // d3.timeDay.range generates an array of Date objects, one for each day.
    const timeIntervals = d3.timeDay.range(minTime, maxTime);

    // 3.5. Build the timeseries data for stacking
    const timeseriesData = [];
    for (const t of timeIntervals) {
        const timePoint = { time: t }; // 'time' is the x-axis value

        // For each ID (key), check if it is "active" at time 't'.
        // If yes, set its value to 1, otherwise 0.
        keys.forEach(key => {
            const isActive = data.some(d =>
                d.id === key && t >= d.start && t <= d.end // Normal time logic
            );
            timePoint[key] = isActive ? 1 : 0;
        });

        timeseriesData.push(timePoint);
    }
    // console.log("Transformed Data:", timeseriesData);

    // --- 4. D3.js Setup ---

    const container = d3.select("#chart-container");
    container.select("svg").remove(); // Clear any existing SVG

    // 4.1. Define margins and dimensions
    const margin = { top: 20, right: 30, bottom: 40, left: 30 };
    const containerWidth = container.node().getBoundingClientRect().width;
    const width = Math.max(1000, containerWidth); // Min width of 1000px

    // 4.2. Create the Stack Generator
    const stackGenerator = d3.stack()
        .keys(keys)
        .order(d3.stackOrderNone)  // Use the order of the 'keys' array
        .offset(d3.stackOffsetNone); // Stack from y=0

    const series = stackGenerator(timeseriesData); // This computes the [y0, y1] values

    // 4.3. Calculate height based on the max stack
    // Find the maximum stack height (max number of concurrent items)
    const maxHeight = d3.max(series, d => d3.max(d, d => d[1]));
    const height = maxHeight * 20 + margin.top + margin.bottom; // 20px per layer

    // 4.4. Create the SVG container
    const svg = container.append("svg")
        .attr("width", width)
        .attr("height", height)
        .attr("class", "timeline-chart");

    // 4.5. Define Scales

    // X-Axis Scale (Time)
    const xScale = d3.scaleTime()
        .domain([minTime, maxTime]) // CHANGED: now from min to max (left to right)
        .range([margin.left, width - margin.right]);

    // Y-Axis Scale (Stack Height)
    const yScale = d3.scaleLinear()
        .domain([0, maxHeight]) // From 0 to the max concurrent items
        .range([height - margin.bottom, margin.top]); // SVG y-axis is inverted (0 is top)

    // Color Scale
    const colorScale = d3.scaleOrdinal(d3.schemeTableau10).domain(keys);

    // 4.6. Define the Area Generator
    const areaGenerator = d3.area()
        .x(d => xScale(d.data.time)) // x-position based on time
        .y0(d => yScale(d[0]))       // Bottom of the area (y0)
        .y1(d => yScale(d[1]))       // Top of the area (y1)
        .curve(d3.curveMonotoneX); // Smooth curves

    // 4.7. Draw the X-Axis
    // d3.axisBottom with scaleTime automatically formats ticks (days, months, years)
    const xAxis = d3.axisBottom(xScale).ticks(width / 80).tickSizeOuter(0);
    svg.append("g")
        .attr("class", "x-axis")
        .attr("transform", `translate(0, ${height - margin.bottom})`)
        .call(xAxis);

    // 4.8. Draw the Areas (the layers)
    svg.selectAll(".area-group")
        .data(series)
        .join("g")
        .attr("class", "area-group")
        .append("path")
        .attr("class", "area")
        .attr("d", areaGenerator)
        .attr("fill", d => colorScale(d.key));

    // 4.9. Draw the Labels
    svg.selectAll(".area-label-group")
        .data(series)
        .join("g")
        .attr("class", "area-label-group")
        .each(function (d) {
            // Find the first data point in this series where the height is > 0
            const firstDataPoint = d.find(point => (point[1] - point[0]) > 0);

            if (firstDataPoint) {
                // Get position for the label
                const xPos = xScale(firstDataPoint.data.time) + 5; // 5px from the left edge
                const yPos = yScale((firstDataPoint[0] + firstDataPoint[1]) / 2); // Vertically centered in the layer

                // Add the text label
                d3.select(this).append("text")
                    .attr("class", "area-label")
                    .attr("x", xPos)
                    .attr("y", yPos)
                    .attr("dy", "0.35em") // Vertical alignment trick
                    .text(d.key);
            }
        });
}
