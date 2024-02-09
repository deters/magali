#!/usr/bin/env node
import { exec } from "child_process"
import fs from "fs/promises"

import * as yargs from "yargs"
//import * as Mustache from "mustache"
import * as Mustache from "handlebars"

const catMe = require("cat-me")
const moment = require(`moment-timezone`)
const unescapeJs = require("unescape-js")
const ical2json = require("ical2json")
const path = require("path")

main()

/** main method */
async function main() {

  try {

    // process arguments
    const argv = await get_command_line_arguments()

    if (argv.calendar) {
      let calendar_file = argv.calendar

      let input_file = calendar_file



      if (!await file_exists(input_file)) {
        throw new Error('Calendar file does not exists: ' + input_file);
      }

      let calendar_view = await parse_calendar_from_file(input_file)

      console.log(calendar_view)

      let template_file = `./${calendar_view.template}.${calendar_view.lang}.html`
      let output_file = `./${path.parse(input_file).name}.html`

      if (await file_exists(output_file)) {
        if (!argv.force) {
          console.log(
            `Output file already exists: "${output_file}\nuse --force to replace"`
          )
        }
      }
      await render_output(calendar_view, template_file, output_file)

      console.log(`Output file: ${output_file}`)

      if (argv.open) {
        exec(`open "${output_file}"`)
      }
    }

    console.log(catMe("confused"))


  } catch (error) {
    console.log(error);
  }

}

async function get_command_line_arguments() {
  return await yargs
    .option("calendar", {
      alias: "c",
      description: "Calendar file",
      type: "string",
    })
    .option("force", {
      alias: "f",
      description: "Force (overwrite existing calendar)",
      type: "boolean",
    })

    .option("open", {
      alias: "x",
      description: "Open the generated file",
      type: "boolean",
    })
    .help()
    .alias("help", "h").argv
}

/** generate the html based on the calendar view */
async function render_output(
  calendar_view: any,
  template_file: string,
  output_file: string
) {


  if (! await file_exists(template_file)) {
    throw new Error('Template file not found: ' + template_file);
  }

  let template = await read_file(template_file);
  try {

    let parse = Mustache.compile(template, { strict: true })
    let rendered_template = parse(calendar_view)

    await fs.writeFile(output_file, rendered_template)

  } catch (error: any) {
    if (error.lineNumber) {
      console.log(error.message + ` ` + template.split(`\n`)[error.lineNumber - 1])


      let parse = Mustache.compile(template)
      let rendered_template = parse(calendar_view)

      await fs.writeFile(output_file, rendered_template)


    } else {
      throw (error)
    }
  }



}

async function read_file(template_file: string): Promise<string> {
  return await fs.readFile(template_file).then((buffer) => {
    return buffer.toString()
  })
}

// this method
async function parse_calendar_from_file(calendar_filename: string) {
  console.log(`
  --------------------------------------------------------------------
  CALENDAR: "${calendar_filename}"
  --------------------------------------------------------------------
  `)

  let ics_content = await read_file(calendar_filename)

  const json_content = ical2json.convert(ics_content)

  const event_list = json_content.VCALENDAR[0].VEVENT

  let lang: string = ``
  let template: string = ``

  let events_simplified = event_list.map((evento: any) => {
    let simplified_event: any = {
      summary: evento.SUMMARY,
      url: evento.URL,
      location: unescapeJs(evento.LOCATION || ""),
    }

    let start_key = get_dtstart_key(evento)
    let end_key = get_dtend_key(evento)

    let start = evento[start_key]
    let end = evento[end_key]

    simplified_event.start_timezone = start_key.split("TZID=")[1]
    simplified_event.end_timezone = end_key.split("TZID=")[1]

    let start_time = start.split(`T`)[1] || ``
    let end_time = end.split(`T`)[1] || ``

    simplified_event.start_time = `${start_time.substr(
      0,
      2
    )}:${start_time.substr(2, 2)}`
    simplified_event.end_time = `${end_time.substr(0, 2)}:${end_time.substr(
      2,
      2
    )}`

    simplified_event.start_moment = moment.tz(
      start,
      simplified_event.start_timezone
    )
    simplified_event.end_moment = moment.tz(end, simplified_event.end_timezone)

    if (!evento.DESCRIPTION) {
      throw new Error("No description for the event: " + evento.SUMMARY)
    }
    let lines_from_description = unescapeJs(evento.DESCRIPTION).split(`\n`)

    lines_from_description.map((line: string) => {
      let splited_line = line.split(`:`)

      function toTitleCase(str: string) {
        return str.replace(/\w\S*/g, function (txt) {
          return txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()
        })
      }

      if (splited_line.length >= 2) {
        let key = splited_line[0].trim()
        let value = splited_line.splice(1).join(`:`).trim()

        let newkey = key.split(" ").map(toTitleCase).join("")

        simplified_event[newkey] = value
      }
    })

    let xtemplate = evento["X-TEMPLATE"]
    let xlang = evento["X-LANG"]

    if (xtemplate) {
      template = xtemplate
    }

    if (xlang) {
      lang = xlang
    }

    let tag = evento["X-CARLTAG"]?.trim()

    simplified_event.tag = tag

    return simplified_event
  })

  let sorted_events = events_simplified.sort((a: any, b: any) => {
    return a.start_moment.diff(b.start_moment)
  })

  let previous_event: any = null
  let complete_events = sorted_events.map((e: any, i: number) => {
    e.sequence = i + 1

    if (!e.tag) {
      e.tag = `event-${i + 1}`
    }

    moment.locale(lang)

    e.start_date_human = e.start_moment.format("LL")
    e.end_date_human = e.end_moment.format("LL")

    e.start_human = e.start_moment.format("LLLL")
    e.end_human = e.end_moment.format("LLLL")

    e.duration_human = moment
      .duration(e.end_moment.diff(e.start_moment))
      .humanize()

    if (previous_event) {
      e.wait_interval = moment
        .duration(previous_event.end_moment.diff(e.start_moment))
        .humanize()
    }

    previous_event = e

    return e
  })

  let calendar_view: any = {
    lang: lang,
    template: template,
    client_name: json_content.VCALENDAR[0]["X-WR-CALNAME"],
  }

  complete_events.map((e: any) => {
    if (e.tag) {
      calendar_view[e.tag] = e
    }
  })

  let range = getRange(
    calendar_view.clientinfo.start_moment,
    calendar_view.clientinfo.end_moment
  )
  range.map((d: any, i: number) => {
    d.locale(calendar_view.lang)
    calendar_view[`day${i + 1}`] = d.format("LL")
  })

  if (!calendar_view.template) {
    throw `The file ${calendar_filename} has no x-template`
  }

  if (!calendar_view.lang) {
    throw `The file ${calendar_filename} has no x-lang`
  }

  if (!sorted_events.length) {
    throw `The file ${calendar_filename} has no events`
  }

  return calendar_view
}

function get_dtend_key(evento: any) {
  return Object.keys(evento).filter((k) => k.indexOf("DTEND") >= 0)[0]
}

function get_dtstart_key(evento: any) {
  return Object.keys(evento).filter((k) => k.indexOf("DTSTART") >= 0)[0]
}

function getRange(startDate: any, endDate: any) {
  let diff = Math.trunc(moment.duration(endDate.diff(startDate)).asDays())
  let range: any[] = []
  for (let i = 0; i < diff; i++) {
    range.push(moment(startDate).add(i, "day"))
  }
  return range
}

async function file_exists(path: string) {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}
