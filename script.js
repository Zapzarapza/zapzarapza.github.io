document.addEventListener("DOMContentLoaded", () => {
    // 1. Set up the event listener for the file input
    const fileInput = document.getElementById("csvFile");
    fileInput.addEventListener("change", handleFileSelect, false);
});

// 2. Handle the file selection and parsing
function handleFileSelect(event) {
    const file = event.target.files[0];
    
    Papa.parse(file, {
        header: true,         // First row is the header
        dynamicTyping: false, // IMPORTANT: Disable, so date strings are not parsed as numbers
        skipEmptyLines: true, // Skip empty rows
        complete: function(results) {
            // Start processing and drawing the chart
            processDataAndDrawChart(results.data);
        }
    });
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
        .each(function(d) {
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
