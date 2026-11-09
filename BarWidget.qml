import QtQuick
import QtQuick.Layouts
import Quickshell
import Quickshell.Services.UPower
import qs.Commons
import qs.Commons as Commons
import qs.Ui

Panel {
  id: root
  moduleName: "rubar.omacharge-limit"
  ipcTarget: "rubar.omacharge-limit"

  Commons.Translations { id: strings; directory: Qt.resolvedUrl("i18n") }

  readonly property color foreground: bar ? bar.foreground : Commons.Color.foreground
  readonly property color dim: Qt.darker(foreground, 1.55)
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

  readonly property bool isFull: svc.busy ? svc.pendingMode === "full" : svc.mode === "full"
  readonly property string pillText: svc.mode === "" ? "…" : (isFull ? "⚡" : "🌿")
  readonly property string statusText: {
    if (svc.mode === "") return ""
    if (svc.busy) return strings.t("panel.applying")
    return isFull ? strings.t("status.holdingFull") : strings.t("status.saver")
  }

  Service {
    id: svc
  }

  onOpenedChanged: {
    svc.setPolling(opened)
    if (opened) svc.refresh()
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    text: svc.supported ? root.pillText : "—"
    tooltipText: strings.t("bar.tooltip") + (svc.mode !== "" ? ": " + (isFull ? "100%" : "80%") : "")
    onPressed: function(code) {
      if (code === Qt.RightButton) svc.applyMode(root.isFull ? "saver" : "full")
      else if (code === Qt.MiddleButton) svc.refresh()
      else root.toggle()
    }
  }

  KeyboardPanel {
    id: panel
    anchorItem: button
    owner: root
    bar: root.bar
    open: root.opened
    focusTarget: panel.loadedContent
    contentWidth: panel.fittedContentWidth(Style.space(360))
    contentHeight: panel.fittedContentHeight(panel.loadedContentHeight)

    content: PanelKeyCatcher {
      anchors.fill: parent
      implicitHeight: column.implicitHeight
      onMoveRequested: function(dx, dy) {
        if (dy !== 0) root.moveSelection(dy > 0 ? 1 : -1)
      }
      onActivateRequested: root.activateSelected()
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }

      Column {
        id: column
        width: parent.width
        spacing: Style.space(12)

        PanelHero {
          width: parent.width
          title: strings.t("panel.title")
          meta: root.statusText
          detail: svc.mode !== "" ? (isFull ? "100%" : "80%") : ""
          foreground: root.foreground
          fontFamily: root.fontFamily
          iconComponent: Component {
            Text {
              textFormat: Text.PlainText
              text: root.pillText === "…" ? "🔋" : root.pillText
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.display
            }
          }
        }

        Text {
          visible: !svc.supported
          width: parent.width
          textFormat: Text.PlainText
          text: strings.t("panel.errorNoInterface")
          color: Commons.Color.urgent
          font.family: root.fontFamily
          font.pixelSize: Style.font.body
          wrapMode: Text.WordWrap
        }

        Column {
          visible: svc.supported
          width: parent.width
          spacing: Style.space(6)

          ModeRow {
            width: parent.width
            mode: "saver"
            title: strings.t("panel.saver")
            caption: strings.t("panel.saverCaption")
            selected: svc.mode !== "" && !root.isFull
            rowCursor: root.rowIndex === 0
            rowBusy: svc.busy
          }

          ModeRow {
            width: parent.width
            mode: "full"
            title: strings.t("panel.full")
            caption: strings.t("panel.fullCaption")
            selected: root.isFull
            rowCursor: root.rowIndex === 1
            rowBusy: svc.busy
          }
        }

        Text {
          visible: svc.lastError !== ""
          width: parent.width
          textFormat: Text.PlainText
          text: svc.lastError === "no-interface" ? strings.t("panel.errorNoInterface") : strings.t("panel.errorWrite")
          color: Commons.Color.urgent
          font.family: root.fontFamily
          font.pixelSize: Style.font.bodySmall
          wrapMode: Text.WordWrap
        }
      }
    }
  }

  property int rowIndex: 0

  function moveSelection(delta) {
    rowIndex = Math.max(0, Math.min(1, rowIndex + delta))
  }

  function activateSelected() {
    svc.applyMode(rowIndex === 1 ? "full" : "saver")
  }

  onIsFullChanged: if (!svc.busy && svc.mode !== "") rowIndex = root.isFull ? 1 : 0

  // Selecting a row clears a stale error and follows the committed mode.
  Connections {
    target: svc
    function onModeChanged() { if (!svc.busy && svc.mode !== "") { root.rowIndex = root.isFull ? 1 : 0; svc.lastError = "" } }
  }

  component ModeRow: CursorSurface {
    property string mode: ""
    property string title: ""
    property string caption: ""
    property bool selected: false
    property bool rowCursor: false
    property bool rowBusy: false

    hasCursor: rowCursor
    current: selected === true
    foreground: root.foreground
    implicitHeight: rowContent.implicitHeight + Style.spacing.rowPaddingX

    MouseArea {
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: Qt.PointingHandCursor
      onEntered: root.rowIndex = mode === "full" ? 1 : 0
      onClicked: svc.applyMode(mode)
    }

    RowLayout {
      id: rowContent
      anchors.left: parent.left
      anchors.right: parent.right
      anchors.verticalCenter: parent.verticalCenter
      anchors.leftMargin: Style.space(10)
      anchors.rightMargin: Style.space(10)
      spacing: Style.space(8)

      Text {
        textFormat: Text.PlainText
        Layout.preferredWidth: Style.space(14)
        text: selected ? "" : ""
        color: root.foreground
        font.family: root.fontFamily
        font.pixelSize: Style.font.bodySmall
        Layout.alignment: Qt.AlignVCenter
      }

      ColumnLayout {
        Layout.fillWidth: true
        spacing: Style.space(1)

        Text {
          textFormat: Text.PlainText
          Layout.fillWidth: true
          text: title
          color: root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.body
          font.bold: selected
          elide: Text.ElideRight
        }

        Text {
          textFormat: Text.PlainText
          Layout.fillWidth: true
          visible: caption !== ""
          text: caption
          color: root.dim
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          elide: Text.ElideRight
        }
      }
    }
  }
}
